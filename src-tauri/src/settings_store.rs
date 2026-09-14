//! 設定ファイルの読み書き（design-decisions.md 11.1）。
//!
//! 起動時に1度だけ読み、以後はメモリ上の値を正とする。変更はdebounceしてから一時ファイルへ
//! 書き、renameで置き換える。終了時は待たずに書き出す。
//!
//! 読めない設定（壊れたJSON、新しい版が書いたファイル、読み取りの失敗）は退避してから
//! 既定値で始める。退避できなかった場合はそのセッションで書き込まない。読めないまま
//! 上書きすると、利用者が手で直せたかもしれない設定を失うためである。
//!
//! 値の範囲への丸め（サイドバー幅、文字サイズ）はここで行わない。範囲と段階の正本は
//! Frontend（`src/state/sidebar-width.ts`、`src/state/font-scale.ts`）にあり、保存値と
//! 実効値を区別するのもFrontendである（10.2、10.3）。

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::i18n::Language;
use crate::settings::{SCHEMA_VERSION, SETTINGS_FILE_NAME, Settings, UiSettings, UiSettingsUpdate};

/// 変更から書込みまで待つ時間。
///
/// サイドバーの幅はキーを押し続ける間に続けて変わる。1回ごとに書くとファイルの置き換えが
/// 連続するため、変更が止まってから書く。終了時は待たずに書き出すため、この時間は
/// 途中で失われうる変更の量ではない。
pub const WRITE_DEBOUNCE: Duration = Duration::from_millis(500);

/// 起動時の読み込みの結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadOutcome {
    /// 読めた。ファイルがなかった場合（初回起動）も含む。
    Loaded,
    /// 読めなかったため退避し、既定値で始めた。
    ResetAfterBackup,
    /// 読めず、退避もできなかった。既定値で始め、このセッションでは書き込まない。
    ResetWithoutSaving,
}

impl LoadOutcome {
    /// 利用者へ知らせる必要があるか（11.1「破損時は既定値で起動し、通知する」）。
    pub fn needs_notice(self) -> bool {
        self != LoadOutcome::Loaded
    }
}

/// 書込みの失敗を受け取る関数。書込みは別スレッドで行うため、呼び出し元へ返せない。
pub type WriteErrorReporter = Box<dyn Fn(io::Error) + Send>;

/// 読み込んだ設定と、その変更を書き出すスレッド。
pub struct SettingsStore {
    current: Mutex<Settings>,
    writer: Option<Writer>,
}

impl SettingsStore {
    /// 設定ディレクトリから読み込んで書込みスレッドを始める。
    pub fn open(dir: PathBuf, report: WriteErrorReporter) -> (Self, LoadOutcome) {
        Self::open_with_debounce(dir, report, WRITE_DEBOUNCE)
    }

    fn open_with_debounce(
        dir: PathBuf,
        report: WriteErrorReporter,
        debounce: Duration,
    ) -> (Self, LoadOutcome) {
        let (settings, outcome) = load(&dir);
        let writer = match outcome {
            LoadOutcome::ResetWithoutSaving => None,
            _ => Some(Writer::start(dir, report, debounce)),
        };
        let store = Self {
            current: Mutex::new(settings),
            writer,
        };
        (store, outcome)
    }

    /// 現在の設定。
    pub fn settings(&self) -> Settings {
        self.lock().clone()
    }

    /// Frontendへ渡す投影を作る。
    ///
    /// 最近使ったフォルダーは、不透明なIDの対応表を実装するまで空で返す（11.1）。
    pub fn ui_settings(&self, effective_language: Language) -> UiSettings {
        let settings = self.lock();
        UiSettings {
            theme: settings.theme,
            language: settings.language,
            effective_language,
            sidebar_width: settings.sidebar_width,
            sidebar_visible: settings.sidebar_visible,
            font_scale_percent: settings.font_scale_percent,
            recent_folders: Vec::new(),
        }
    }

    /// Frontendから届いた変更を反映し、書込みを予約する。値が変わらなければ書かない。
    pub fn update(&self, update: UiSettingsUpdate) {
        let mut settings = self.lock();
        let before = settings.clone();
        if let Some(theme) = update.theme {
            settings.theme = theme;
        }
        if let Some(width) = update.sidebar_width {
            settings.sidebar_width = width;
        }
        if let Some(visible) = update.sidebar_visible {
            settings.sidebar_visible = visible;
        }
        if let Some(percent) = update.font_scale_percent {
            settings.font_scale_percent = percent;
        }
        if *settings != before
            && let Some(writer) = &self.writer
        {
            writer.save(settings.clone());
        }
    }

    /// 予約中の書込みを待たずに書き出す。終了時に呼ぶ。
    pub fn flush(&self) {
        if let Some(writer) = &self.writer {
            writer.flush();
        }
    }

    fn lock(&self) -> MutexGuard<'_, Settings> {
        // ロックが毒された時点で状態の一貫性は失われている。`panic = "abort"` の下では
        // 毒される経路自体が生じないため、回復は試みない（12章）。
        self.current.lock().expect("設定のロックに失敗")
    }
}

/// 設定を読む。読めなければ退避して既定値を返す。
fn load(dir: &Path) -> (Settings, LoadOutcome) {
    let path = dir.join(SETTINGS_FILE_NAME);
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return (Settings::default(), LoadOutcome::Loaded);
        }
        Err(_) => return (Settings::default(), back_up(&path)),
    };
    match parse(&bytes) {
        Some(settings) => (settings, LoadOutcome::Loaded),
        None => (Settings::default(), back_up(&path)),
    }
}

/// 設定ファイルの内容を解釈する。使えない内容なら `None` を返す。
///
/// `schemaVersion` が現在より大きいファイルは新しい版が書いたものであり、未知のキーを
/// 落としたまま読むと次の書込みで新しい版の設定を壊すため、使えないものとして扱う。
/// 小さいファイルはマイグレーションの対象だが、1より前の版は存在しないため、版を
/// 現在の値へ揃えるだけでよい。
fn parse(bytes: &[u8]) -> Option<Settings> {
    let mut settings: Settings = serde_json::from_slice(bytes).ok()?;
    if settings.schema_version > SCHEMA_VERSION {
        return None;
    }
    settings.schema_version = SCHEMA_VERSION;
    Some(settings)
}

/// 読めなかった設定ファイルを別名へ移す。
///
/// 名前に時刻を含めるのは、壊れた設定を繰り返し退避したときに前の退避を上書きしない
/// ためである。
fn back_up(path: &Path) -> LoadOutcome {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let backup = path.with_file_name(format!("{SETTINGS_FILE_NAME}.corrupt-{millis}"));
    match fs::rename(path, backup) {
        Ok(()) => LoadOutcome::ResetAfterBackup,
        Err(_) => LoadOutcome::ResetWithoutSaving,
    }
}

/// 設定を一時ファイルへ書き、renameで置き換える。
///
/// 書込みの途中で終了しても、置き換え前の設定ファイルは残る。
fn write(dir: &Path, settings: &Settings) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let json = serde_json::to_vec_pretty(settings).map_err(io::Error::other)?;
    let temporary = dir.join(format!("{SETTINGS_FILE_NAME}.tmp"));
    let mut file = fs::File::create(&temporary)?;
    file.write_all(&json)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, dir.join(SETTINGS_FILE_NAME))
}

enum Message {
    Save(Settings),
    Flush(Sender<()>),
}

/// 設定の書込みを担うスレッド。
struct Writer {
    sender: Mutex<Option<Sender<Message>>>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Writer {
    fn start(dir: PathBuf, report: WriteErrorReporter, debounce: Duration) -> Self {
        let (sender, receiver) = mpsc::channel::<Message>();
        let thread = std::thread::spawn(move || {
            let mut pending: Option<Settings> = None;
            let write_pending = |pending: &mut Option<Settings>| {
                if let Some(settings) = pending.take()
                    && let Err(error) = write(&dir, &settings)
                {
                    report(error);
                }
            };
            loop {
                let message = if pending.is_some() {
                    match receiver.recv_timeout(debounce) {
                        Ok(message) => message,
                        Err(RecvTimeoutError::Timeout) => {
                            write_pending(&mut pending);
                            continue;
                        }
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                } else {
                    match receiver.recv() {
                        Ok(message) => message,
                        Err(_) => break,
                    }
                };
                match message {
                    Message::Save(settings) => pending = Some(settings),
                    Message::Flush(done) => {
                        write_pending(&mut pending);
                        // 待っている側が先に終わっていても、書込みは済んでいる。
                        let _ = done.send(());
                    }
                }
            }
            // 送り手が閉じた（ストアが破棄された）ときも、予約中の変更を失わない。
            write_pending(&mut pending);
        });
        Self {
            sender: Mutex::new(Some(sender)),
            thread: Mutex::new(Some(thread)),
        }
    }

    fn save(&self, settings: Settings) {
        self.send(Message::Save(settings));
    }

    fn flush(&self) {
        let (done, wait) = mpsc::channel();
        if self.send(Message::Flush(done)) {
            // スレッドが書込みを終えるまで待つ。終了処理がプロセスを閉じる前に書き終えるため。
            let _ = wait.recv();
        }
    }

    /// 送れたかを返す。スレッドが既に終わっていれば送れない。
    fn send(&self, message: Message) -> bool {
        self.sender
            .lock()
            .expect("設定の送り手のロックに失敗")
            .as_ref()
            .is_some_and(|sender| sender.send(message).is_ok())
    }
}

impl Drop for Writer {
    fn drop(&mut self) {
        // 送り手を閉じてスレッドに予約中の変更を書かせ、終わるまで待つ。
        self.sender
            .lock()
            .expect("設定の送り手のロックに失敗")
            .take();
        if let Some(thread) = self
            .thread
            .lock()
            .expect("書込みスレッドのロックに失敗")
            .take()
        {
            thread.join().expect("設定の書込みスレッドが異常終了した");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::LanguagePreference;
    use crate::settings::{DEFAULT_SIDEBAR_WIDTH, ThemePreference};
    use std::sync::Arc;

    /// テスト用の一時フォルダー。終了時に削除する。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("md-peruse-settings-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("一時フォルダーを作成できない");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn settings_file(&self) -> PathBuf {
            self.0.join(SETTINGS_FILE_NAME)
        }

        fn backups(&self) -> Vec<String> {
            fs::read_dir(&self.0)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .filter(|name| name.contains(".corrupt-"))
                .collect()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// 書込みの失敗を集める。
    fn collecting_reporter() -> (WriteErrorReporter, Arc<Mutex<Vec<io::ErrorKind>>>) {
        let errors = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&errors);
        let reporter: WriteErrorReporter =
            Box::new(move |error| sink.lock().unwrap().push(error.kind()));
        (reporter, errors)
    }

    fn open(dir: &TempDir, debounce: Duration) -> (SettingsStore, LoadOutcome) {
        let (reporter, _) = collecting_reporter();
        SettingsStore::open_with_debounce(dir.path().to_owned(), reporter, debounce)
    }

    fn read_back(dir: &TempDir) -> Settings {
        serde_json::from_slice(&fs::read(dir.settings_file()).expect("設定ファイルがない"))
            .expect("書いた設定を読めない")
    }

    #[test]
    fn file_contents_are_interpreted() {
        let cases: [(&str, &[u8], Option<ThemePreference>); 5] = [
            (
                "正しい設定",
                br#"{"schemaVersion":1,"theme":"dark"}"#,
                Some(ThemePreference::Dark),
            ),
            // 1より前の版は存在しないが、読めた値は現在の版として扱う。
            (
                "古い版",
                br#"{"schemaVersion":0,"theme":"light"}"#,
                Some(ThemePreference::Light),
            ),
            ("新しい版", br#"{"schemaVersion":2,"theme":"dark"}"#, None),
            ("壊れたJSON", br#"{"schemaVersion":1,"#, None),
            ("型の違う値", br#"{"sidebarWidth":"wide"}"#, None),
        ];
        for (name, bytes, expected) in cases {
            let parsed = parse(bytes);
            assert_eq!(parsed.as_ref().map(|s| s.theme), expected, "{name}");
            if let Some(settings) = parsed {
                assert_eq!(settings.schema_version, SCHEMA_VERSION, "{name}");
            }
        }
    }

    /// 初回起動（ファイルなし）は既定値で始め、通知しない。
    #[test]
    fn a_missing_file_starts_with_defaults() {
        let dir = TempDir::new("missing");
        let (store, outcome) = open(&dir, WRITE_DEBOUNCE);
        assert_eq!(outcome, LoadOutcome::Loaded);
        assert!(!outcome.needs_notice());
        assert_eq!(store.settings(), Settings::default());
    }

    /// 読めない設定は退避してから既定値で始め、書込みを続ける。
    #[test]
    fn an_unreadable_file_is_backed_up() {
        let dir = TempDir::new("corrupt");
        fs::write(dir.settings_file(), b"{ broken").unwrap();

        let (store, outcome) = open(&dir, Duration::from_millis(10));

        assert_eq!(outcome, LoadOutcome::ResetAfterBackup);
        assert!(outcome.needs_notice());
        assert_eq!(store.settings(), Settings::default());
        let backups = dir.backups();
        assert_eq!(backups.len(), 1, "{backups:?}");
        assert_eq!(
            fs::read(dir.path().join(&backups[0])).unwrap(),
            b"{ broken",
            "退避した内容が元のファイルと異なる"
        );

        store.update(UiSettingsUpdate {
            sidebar_width: Some(320),
            ..UiSettingsUpdate::default()
        });
        store.flush();
        assert_eq!(read_back(&dir).sidebar_width, 320);
    }

    /// 読み取りそのものに失敗した場合も、退避してから既定値で始める。
    #[test]
    fn a_file_that_cannot_be_read_is_backed_up() {
        let dir = TempDir::new("unreadable");
        // 設定ファイルの名前のフォルダーは読めないが、renameで退避できる。
        fs::create_dir(dir.settings_file()).unwrap();

        let (_store, outcome) = open(&dir, Duration::from_millis(10));

        assert_eq!(outcome, LoadOutcome::ResetAfterBackup);
        assert!(!dir.settings_file().exists());
        assert_eq!(dir.backups().len(), 1);
    }

    /// 退避に失敗したら、書込みを行わない読込結果になる。書込みスレッドを始めないことは
    /// `open_with_debounce` の分岐による。
    #[test]
    fn a_failed_backup_means_starting_without_saving() {
        let dir = TempDir::new("no-backup");
        let outcome = back_up(&dir.path().join("does-not-exist.json"));
        assert_eq!(outcome, LoadOutcome::ResetWithoutSaving);
        assert!(outcome.needs_notice());
    }

    /// 書込みを行わないストアは、変更を受けてもファイルを作らない。
    #[test]
    fn a_store_without_saving_does_not_write() {
        let dir = TempDir::new("readonly");
        let store = SettingsStore {
            current: Mutex::new(Settings::default()),
            writer: None,
        };
        store.update(UiSettingsUpdate {
            theme: Some(ThemePreference::Dark),
            ..UiSettingsUpdate::default()
        });
        store.flush();
        assert_eq!(store.settings().theme, ThemePreference::Dark);
        assert!(!dir.settings_file().exists());
    }

    /// 連続した変更はまとめて書き、最後の値が残る。
    #[test]
    fn changes_are_written_after_the_debounce() {
        let dir = TempDir::new("debounce");
        let (store, _) = open(&dir, Duration::from_millis(50));

        for width in [290, 300, 310] {
            store.update(UiSettingsUpdate {
                sidebar_width: Some(width),
                ..UiSettingsUpdate::default()
            });
        }
        // 待ち時間の内側ではまだ書いていない。
        assert!(!dir.settings_file().exists());

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !dir.settings_file().exists() {
            assert!(std::time::Instant::now() < deadline, "書込みが行われない");
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(read_back(&dir).sidebar_width, 310);
    }

    /// `flush` は待たずに書き出し、書き終えてから戻る。一時ファイルは残さない。
    #[test]
    fn flush_writes_immediately() {
        let dir = TempDir::new("flush");
        let (store, _) = open(&dir, Duration::from_secs(60));

        store.update(UiSettingsUpdate {
            theme: Some(ThemePreference::Light),
            sidebar_visible: Some(false),
            font_scale_percent: Some(125),
            ..UiSettingsUpdate::default()
        });
        store.flush();

        let written = read_back(&dir);
        assert_eq!(written.theme, ThemePreference::Light);
        assert!(!written.sidebar_visible);
        assert_eq!(written.font_scale_percent, 125);
        assert_eq!(written.sidebar_width, DEFAULT_SIDEBAR_WIDTH);
        assert!(
            !dir.path()
                .join(format!("{SETTINGS_FILE_NAME}.tmp"))
                .exists()
        );
    }

    /// ストアを破棄するときも予約中の変更を書く。
    #[test]
    fn dropping_the_store_writes_pending_changes() {
        let dir = TempDir::new("drop");
        let (store, _) = open(&dir, Duration::from_secs(60));
        store.update(UiSettingsUpdate {
            sidebar_width: Some(400),
            ..UiSettingsUpdate::default()
        });
        drop(store);
        assert_eq!(read_back(&dir).sidebar_width, 400);
    }

    /// 値が変わらない更新では書かない。
    #[test]
    fn unchanged_updates_are_not_written() {
        let dir = TempDir::new("unchanged");
        let (store, _) = open(&dir, Duration::from_millis(10));
        store.update(UiSettingsUpdate {
            sidebar_width: Some(DEFAULT_SIDEBAR_WIDTH),
            ..UiSettingsUpdate::default()
        });
        store.flush();
        assert!(!dir.settings_file().exists());
    }

    /// 書き込めなければ報告する。
    #[test]
    fn write_failures_are_reported() {
        let dir = TempDir::new("unwritable");
        // 設定ディレクトリの位置にファイルを置き、ディレクトリを作れないようにする。
        let blocked = dir.path().join("blocked");
        fs::write(&blocked, b"").unwrap();
        let (reporter, errors) = collecting_reporter();
        let (store, outcome) = SettingsStore::open_with_debounce(
            blocked.join("settings"),
            reporter,
            Duration::from_millis(10),
        );
        // 読込ではファイルが見つからないだけであり、初回起動と区別しない。
        assert_eq!(outcome, LoadOutcome::Loaded);

        store.update(UiSettingsUpdate {
            theme: Some(ThemePreference::Dark),
            ..UiSettingsUpdate::default()
        });
        store.flush();
        assert_eq!(errors.lock().unwrap().len(), 1);
    }

    /// 投影は絶対パスを含まず、実際の表示言語を添える（11.1）。
    #[test]
    fn the_projection_carries_ui_values_only() {
        let dir = TempDir::new("projection");
        fs::write(
            dir.settings_file(),
            br#"{"schemaVersion":1,"language":"ja","sidebarWidth":350,"recentFolders":["C:\\secret\\docs"],"lastWorkspace":"C:\\secret\\docs"}"#,
        )
        .unwrap();
        let (store, _) = open(&dir, WRITE_DEBOUNCE);

        let ui = store.ui_settings(Language::Ja);
        assert_eq!(ui.language, LanguagePreference::Ja);
        assert_eq!(ui.effective_language, Language::Ja);
        assert_eq!(ui.sidebar_width, 350);
        assert!(ui.recent_folders.is_empty());
        let json = serde_json::to_string(&ui).unwrap();
        assert!(!json.contains("secret"), "{json}");
    }
}
