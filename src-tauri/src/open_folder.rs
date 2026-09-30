//! 「フォルダーを開く」と「ワークスペースを閉じる」の処理（design-decisions.md 6.1、10.1）。
//!
//! メニューの振り分け（`crate::menu_command`）から呼ばれると、Rust側でフォルダー選択
//! ダイアログを開き、選ばれたフォルダーをワークスペースとして開く。成功はeventでFrontendへ
//! 知らせ、失敗はネイティブダイアログで示す。閉じるときもRust側で状態を破棄してから
//! eventで知らせる。フォルダーの選択はWebViewを経由しないため、
//! Frontendへファイルシステム系のcapabilityを渡さない（5.5）。
//!
//! ダイアログは `tauri-plugin-dialog` をRust側からだけ使う。JSのパッケージは入れず、
//! capabilityにもdialogの権限を加えない。

use std::io;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::ipc::error::ErrorCode;
use crate::ipc::message::message;
use crate::ipc::types::WorkspaceOpenedEvent;
use crate::path_guard::WorkspaceRoot;
use crate::recent;
use crate::settings_store::SettingsStore;
use crate::state::AppState;
use crate::telemetry::{Telemetry, TelemetryEvent};
use crate::watch_runtime::{ChangeSink, TauriChangeSink};

/// ワークスペースを開いたことを運ぶTauri eventの名前。
pub const WORKSPACE_OPENED_EVENT: &str = "workspace-opened";

/// ワークスペースを閉じたことを運ぶTauri eventの名前。payloadは持たない。
pub const WORKSPACE_CLOSED_EVENT: &str = "workspace-closed";

/// ワークスペースの開閉と、その通知の送出を一続きにするロック。
///
/// 閉じる処理は別スレッドで行うため、開く処理と入れ違うことがある。状態の変更と送出を
/// まとめて直列にしないと、`workspace-opened` の後に古い `workspace-closed` が届き、
/// Rust側では開いているのにFrontendはwelcome状態になる。
static LIFECYCLE: Mutex<()> = Mutex::new(());

pub(crate) fn lock_lifecycle() -> MutexGuard<'static, ()> {
    // `panic = "abort"` の下では毒される経路が生じない（12章）。
    LIFECYCLE.lock().expect("ワークスペース開閉のロックに失敗")
}

/// ダイアログの親にするウィンドウのラベル（`tauri.conf.json` の `app.windows`）。
pub const MAIN_WINDOW: &str = "main";

/// フォルダー選択ダイアログを開き、選ばれたフォルダーをワークスペースとして開く。
///
/// ダイアログは非同期のAPIを使う。メニューの処理はメインスレッドで呼ばれ、同期のAPIで
/// 待つとダイアログのメッセージループと競合する。
pub fn pick_and_open<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    let mut dialog = app.dialog().file();
    // 親を指定しないと、ダイアログはメインウィンドウと別の場所（別のディスプレイ）に
    // 非モーダルで開き、ダイアログを出したままアプリを操作できてしまう（実測）。
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        dialog = dialog.set_parent(&window);
    }
    dialog.pick_folder(move |picked| {
        // キャンセルされた場合は何もしない。現在のワークスペースも変えない。
        let Some(picked) = picked else {
            return;
        };
        let Ok(path) = picked.into_path() else {
            return;
        };
        if let Err(code) = open_path(&app, &path) {
            show_error(&app, &[code]);
        }
    });
}

/// フォルダーをワークスペースとして開き、記録してからFrontendへ知らせる。
///
/// フォルダーの選択、最近使ったフォルダー、起動時の復元が、ここへ集まる。開けなかった
/// ときは現在のワークスペースを保ち、理由を返す。示し方（ダイアログ、応答、黙って外す）は
/// 呼び出し側が決める。
pub fn open_path<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), ErrorCode> {
    {
        let _lifecycle = lock_lifecycle();
        open_unlocked(app, path)?;
    }
    // 利用者が開いたときだけ記録する。起動時の復元は `open_unlocked` を直接呼ぶため、数えない
    // （11.4）。開閉のロックを放してから記録し、記録の結果は返さない。
    app.state::<Telemetry>().record(TelemetryEvent::OpenFolder);
    Ok(())
}

/// 起動時に、最後のワークスペースを開き直す（9.2）。
///
/// 開けなかったときは、welcome状態のまま起動し、その項目を最近使ったフォルダーからも
/// 取り除く。起動のたびに開けないフォルダーの失敗を示しても、利用者が取れる行動がない
/// ためである。
///
/// 応答の遅いストレージでも起動を待たせないよう、呼び出し側は別のスレッドで呼ぶ。
///
/// 2段階で行う。遅いのはフォルダーを開く（解決する）段階であり、開閉のロックの外で行う。
/// ロックを持ったまま待つと、ロックを待つ `get_workspace_command` が返らず、Frontendの準備が
/// 済まないため、関連付けで渡されたファイルも開けない（9.2）。開くかどうかの判断と、開いた
/// ワークスペースを据える段階は、ロックの内側で行う。
///
/// 判断は、ロックの内側で読み直して行う。フォルダーを開いている間に利用者が「ワークスペースを
/// 閉じる」を終えていても、古いパスを開き直さない。閉じる操作は、ロックの内側で最後の
/// ワークスペースを消す（`close`）。フォルダーを開いている間に利用者が別のフォルダーを
/// 開いていたときも、それを上書きしない。ファイルだけをドロップして開いたloose tabも同じで、
/// 据える切り替えはloose tabとその監視を破棄するため（6.1）、開いたものがあれば据えない。
///
/// `may_commit` は、ワークスペースを据える直前に一度だけ呼ぶ。`false` は、待ちが上限を
/// 超えて取りやめたことを表し、開けたフォルダーは据えない（`crate::launch`）。最後のワークスペース
/// の記録は残し、次の起動でもう一度試す。開けなかったときは、取りやめたかどうかや、利用者が
/// 何かを開いたかどうかによらず外す。
pub fn restore_last_workspace<R: Runtime>(app: &AppHandle<R>, may_commit: impl FnOnce() -> bool) {
    restore_with(app, WorkspaceRoot::open, may_commit);
}

/// `restore_last_workspace` の本体。フォルダーを開く段階を差し替えられるようにしてある。
fn restore_with<R: Runtime>(
    app: &AppHandle<R>,
    open_root: impl FnOnce(&Path) -> io::Result<WorkspaceRoot>,
    may_commit: impl FnOnce() -> bool,
) {
    // 開くものがなければ、フォルダーを開く待ちを始めない。ここでの読みはロックの外であり、
    // 判断ではない。判断は、フォルダーを開いたあとにロックの内側で読み直して行う。
    if app.state::<AppState>().has_open_scope() {
        return;
    }
    let Some(path) = last_workspace(app) else {
        return;
    };
    let root = open_root(Path::new(&path));

    let _lifecycle = lock_lifecycle();
    // 記録が変わっていれば、利用者が閉じたか、別のフォルダーを開いた。
    if last_workspace(app).as_deref() != Some(path.as_str()) {
        return;
    }
    let restored = match root {
        Ok(root) => {
            // 据えると、開いているワークスペースとloose tabを破棄する。利用者が開いたものを残す。
            if app.state::<AppState>().has_open_scope() || !may_commit() {
                return;
            }
            install_unlocked(app, root)
        }
        Err(error) => Err(open_error_code(&error)),
    };
    if restored.is_err() {
        recent::forget(app, &path);
    }
}

fn last_workspace<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.state::<SettingsStore>().settings().last_workspace
}

/// 開いているワークスペース。Frontendが起動時に問い合わせる（`get_workspace_command`）。
///
/// 起動時の復元はWebViewが購読する前に終わることがあり、そのときの `workspace-opened` は
/// 誰にも届かない。Frontendは購読してから問い合わせ、購読後の変化はeventで受ける。
/// 開閉と同じロックの内側で読み、スコープIDと表示名を同じワークスペースのものにする。
pub fn current_workspace<R: Runtime>(app: &AppHandle<R>) -> Option<WorkspaceOpenedEvent> {
    let _lifecycle = lock_lifecycle();
    app.state::<AppState>().current_workspace()
}

/// `open_path` の本体。開閉を直列にするロック（`lock_lifecycle`）を保持した呼び出し元から
/// 呼ぶこと。
fn open_unlocked<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), ErrorCode> {
    let sink: Arc<dyn ChangeSink> = Arc::new(TauriChangeSink::new(app.clone()));
    let opened = open_selected_folder(&app.state::<AppState>(), path, sink)?;
    announce_opened(app, opened);
    Ok(())
}

/// 開いたルートを据え、記録してからFrontendへ知らせる。`open_unlocked` の後半で、ルートを
/// 先に（ロックの外で）開いた呼び出し元が使う。ロックを保持した呼び出し元から呼ぶこと。
fn install_unlocked<R: Runtime>(app: &AppHandle<R>, root: WorkspaceRoot) -> Result<(), ErrorCode> {
    let sink: Arc<dyn ChangeSink> = Arc::new(TauriChangeSink::new(app.clone()));
    let opened = install_selected_folder(&app.state::<AppState>(), root, sink)?;
    announce_opened(app, opened);
    Ok(())
}

/// 開いたワークスペースを最近使ったフォルダーへ記録し、Frontendへ知らせる。
fn announce_opened<R: Runtime>(app: &AppHandle<R>, opened: WorkspaceOpenedEvent) {
    if let Some(root) = app.state::<AppState>().workspace_path() {
        recent::record_opened(app, &root);
    }
    // 送出の失敗は受け手（WebView）がいないときであり、伝える相手がいない。
    let _ = app.emit(WORKSPACE_OPENED_EVENT, opened);
}

/// ワークスペースを閉じ、Frontendをwelcome状態へ戻す（6.1）。
///
/// 監視の停止と画像resource IDの破棄はRust側の状態にあるため、Frontendへ任せず
/// ここで行う。開いていない状態で選ばれても、同じ通知を送ってwelcome状態を保つ。
///
/// 別スレッドで閉じる。走査と読込はワークスペースのロックを保持したままファイルI/Oを
/// 行うため、応答の遅いストレージに対する処理の最中に閉じると、ロックの解放まで待つ。
/// メニューの処理（メインスレッド）で待つと、その間ウィンドウが応答しなくなる。
pub fn close<R: Runtime>(app: &AppHandle<R>) -> JoinHandle<()> {
    let app = app.clone();
    thread::spawn(move || {
        let _lifecycle = lock_lifecycle();
        app.state::<AppState>().close_workspace();
        // 閉じる操作をしたワークスペースは、次の起動で開き直さない（9.2）。
        app.state::<SettingsStore>().clear_last_workspace();
        // 送出の失敗は受け手（WebView）がいないときであり、伝える相手がいない。
        let _ = app.emit(WORKSPACE_CLOSED_EVENT, ());
    })
}

/// 選ばれたフォルダーをワークスペースとして開き、Frontendへ送る通知を作る。
///
/// 開けなかった場合は現在のワークスペースを保つ（`AppState::open_workspace`）。
pub fn open_selected_folder(
    state: &AppState,
    path: &Path,
    sink: Arc<dyn ChangeSink>,
) -> Result<WorkspaceOpenedEvent, ErrorCode> {
    let root = WorkspaceRoot::open(path).map_err(|error| open_error_code(&error))?;
    install_selected_folder(state, root, sink)
}

/// 開いたルートをワークスペースとして据え、Frontendへ送る通知を作る。
fn install_selected_folder(
    state: &AppState,
    root: WorkspaceRoot,
    sink: Arc<dyn ChangeSink>,
) -> Result<WorkspaceOpenedEvent, ErrorCode> {
    state
        .install_workspace(root, sink)
        .map_err(|error| open_error_code(&error))?;
    Ok(state
        .current_workspace()
        .expect("開いた直後のワークスペースはスコープとルートを持つ"))
}

/// ワークスペースを開けなかった理由を `ErrorCode` へ写す。
///
/// 見つからないことだけを分ける。選択から開くまでの間に移動・削除された場合であり、
/// 利用者は選び直せば済む。それ以外（アクセス拒否、監視を開始できない）はフォルダーへ
/// アクセスできないものとして示す。監視のないワークスペースは開けなかったものとして
/// 扱う方針（`AppState::open_workspace`）であり、利用者から見た対処も変わらない。
fn open_error_code(error: &io::Error) -> ErrorCode {
    match error.kind() {
        io::ErrorKind::NotFound => ErrorCode::WorkspaceNotFound,
        _ => ErrorCode::WorkspaceAccessDenied,
    }
}

/// 失敗の理由をネイティブダイアログで示す（12章）。複数の理由は1つのダイアログへ並べる。
///
/// Frontendではなくネイティブダイアログにするのは、失敗したのがWebViewの外で始まった
/// 操作（メニューとダイアログ、起動、設定の書込み）だからである。文言は表示時点のUI言語で
/// 組み立てる（10.5）。
pub fn show_error<R: Runtime>(app: &AppHandle<R>, codes: &[ErrorCode]) {
    let language = app.state::<AppState>().language();
    let text = codes
        .iter()
        .map(|code| message(*code, language))
        .collect::<Vec<_>>()
        .join("\n");
    let mut dialog = app
        .dialog()
        .message(text)
        .title("md-peruse")
        .kind(MessageDialogKind::Error);
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        dialog = dialog.parent(&window);
    }
    dialog.show(|_| {});
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::LanguagePreference;
    use crate::ipc::types::FileChangeEvent;
    use crate::recent::{RECENT_FOLDERS_CHANGED_EVENT, RecentFolders};
    use crate::settings::Settings;
    use crate::telemetry::PackageSignatureKind;
    use crate::telemetry::testing::RecordingLogger;
    use std::fs;
    use std::path::PathBuf;
    use tauri::Listener;

    /// 状態、設定、最近使ったフォルダーの対応表を登録した `mock_app`。
    fn app_with(settings: Settings) -> tauri::App<tauri::test::MockRuntime> {
        app_with_telemetry(
            settings,
            Telemetry::new(Box::new(RecordingLogger::default()), None),
        )
    }

    /// 送るイベントを確かめるため、`Telemetry` を差し替えて始めた `mock_app`。
    fn app_with_telemetry(
        settings: Settings,
        telemetry: Telemetry,
    ) -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(AppState::new(LanguagePreference::System));
        let recents = RecentFolders::new();
        recents.sync(&settings.recent_folders);
        app.manage(recents);
        app.manage(SettingsStore::without_saving(settings));
        app.manage(telemetry);
        app
    }

    /// eventのpayloadを、届いた順に集める。
    fn collect(
        app: &tauri::App<tauri::test::MockRuntime>,
        event: &'static str,
    ) -> Arc<Mutex<Vec<String>>> {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&received);
        app.listen(event, move |event| {
            sink.lock().unwrap().push(event.payload().to_owned());
        });
        received
    }

    /// 正規化した絶対パス（保存する形）。
    fn canonical(path: &Path) -> String {
        fs::canonicalize(path)
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    struct DiscardingSink;

    impl ChangeSink for DiscardingSink {
        fn file_change(&self, _event: FileChangeEvent) {}
        fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
        fn images_changed(&self, _scope_id: &str) {}
    }

    /// テスト用の一時フォルダー。終了時に削除する。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "md-peruse-open-folder-{name}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("一時フォルダーを作成できない");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// 開いたワークスペースのスコープIDと、絶対パスを含まない表示名を通知する。
    #[test]
    fn an_opened_folder_is_reported_with_its_scope_and_label() {
        let temp = TempDir::new("opened");
        let folder = temp.path().join("docs");
        fs::create_dir(&folder).unwrap();
        let state = AppState::new(LanguagePreference::System);

        let opened =
            open_selected_folder(&state, &folder, Arc::new(DiscardingSink)).expect("開けない");

        assert_eq!(Some(opened.scope_id.clone()), state.scope_id());
        let parent = temp.path().file_name().unwrap().to_string_lossy();
        assert_eq!(opened.label, format!("{parent}\\docs"));
        assert!(
            !opened.label.contains(':'),
            "絶対パスを含む: {}",
            opened.label
        );
    }

    /// 閉じるとRust側の状態を破棄してから、Frontendへ通知する（6.1）。
    ///
    /// 走査や読込がワークスペースのロックを保持している間も、呼び出し元（メニューの処理）は
    /// 待たずに戻る。閉じる処理はロックの解放を待ち、その後に通知する。
    #[test]
    fn closing_waits_for_io_off_the_caller_and_then_notifies() {
        let temp = TempDir::new("close");
        let app = app_with(Settings::default());
        let state = app.state::<AppState>();
        open_selected_folder(&state, temp.path(), Arc::new(DiscardingSink)).expect("開けない");
        let scopes_at_notice = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&scopes_at_notice);
        let handle = app.handle().clone();
        app.listen(WORKSPACE_CLOSED_EVENT, move |_| {
            seen.lock()
                .unwrap()
                .push(handle.state::<AppState>().scope_id());
        });

        // 走査や読込がロックを保持している状態を模す。同じスレッドで閉じていれば、ここで
        // 止まって戻らない。
        let closing = state
            .workspace()
            .with(|_| {
                let closing = close(app.handle());
                thread::sleep(std::time::Duration::from_millis(50));
                assert!(
                    scopes_at_notice.lock().unwrap().is_empty(),
                    "I/Oの最中に閉じ終えた"
                );
                closing
            })
            .expect("ワークスペースが開いていない");
        closing.join().expect("閉じる処理が失敗した");

        // 通知の時点で、既に閉じている。
        assert_eq!(*scopes_at_notice.lock().unwrap(), [None]);
    }

    /// 開いたワークスペースは、最近使ったフォルダーの先頭と最後のワークスペースとして記録され、
    /// メニューとFrontendへ知らされる。記録するのは正規化した絶対パスである。
    #[test]
    fn an_opened_folder_is_recorded_and_announced() {
        let temp = TempDir::new("record");
        let folder = temp.path().join("docs");
        fs::create_dir(&folder).unwrap();
        let app = app_with(Settings::default());
        let opened = collect(&app, WORKSPACE_OPENED_EVENT);
        let changed = collect(&app, RECENT_FOLDERS_CHANGED_EVENT);

        open_path(app.handle(), &folder).expect("開けない");

        let settings = app.state::<SettingsStore>().settings();
        assert_eq!(settings.last_workspace, Some(canonical(&folder)));
        assert_eq!(settings.recent_folders, [canonical(&folder)]);
        assert_eq!(opened.lock().unwrap().len(), 1);
        // 一覧の変化は、IDと表示名だけを運ぶ。絶対パスは運ばない。
        let changed = changed.lock().unwrap();
        assert_eq!(changed.len(), 1);
        assert!(changed[0].contains("\"label\""), "{}", changed[0]);
        // JSONでは絶対パスの `C:\` が `C:\\` になる。
        assert!(
            !changed[0].contains(":\\\\"),
            "絶対パスを含む: {}",
            changed[0]
        );
        // メニューの項目にもなる。
        let menu = app.menu().expect("メニューが組み直されていない");
        let recent = crate::menu::find(
            menu.items().unwrap(),
            &crate::menu::MenuCommand::OpenRecentFolder.id(),
        )
        .and_then(|item| item.as_submenu().cloned())
        .expect("最近使ったフォルダーのサブメニューが無い");
        assert_eq!(recent.items().unwrap().len(), 1);
    }

    /// 開けなかったフォルダーは記録せず、何も知らせない。
    #[test]
    fn a_folder_that_cannot_be_opened_is_not_recorded() {
        let temp = TempDir::new("not-recorded");
        let app = app_with(Settings::default());
        let opened = collect(&app, WORKSPACE_OPENED_EVENT);
        let changed = collect(&app, RECENT_FOLDERS_CHANGED_EVENT);

        let error = open_path(app.handle(), &temp.path().join("missing")).unwrap_err();

        assert_eq!(error, ErrorCode::WorkspaceNotFound);
        let settings = app.state::<SettingsStore>().settings();
        assert_eq!(settings.last_workspace, None);
        assert!(settings.recent_folders.is_empty());
        assert!(opened.lock().unwrap().is_empty());
        assert!(changed.lock().unwrap().is_empty());
    }

    /// Store署名のパッケージとして始めた `mock_app`。送った名前を返す送信の口も返す。
    fn store_app(settings: Settings) -> (tauri::App<tauri::test::MockRuntime>, RecordingLogger) {
        let logger = RecordingLogger::default();
        let telemetry = Telemetry::new(Box::new(logger.clone()), Some(PackageSignatureKind::Store));
        (app_with_telemetry(settings, telemetry), logger)
    }

    /// `open_folder` は、利用者がワークスペースを開いたときだけ記録する（11.4）。起動時の復元は
    /// 数えない。起動するだけで送られると、フォルダー中心の利用の指標にならない。
    #[test]
    fn a_restored_workspace_is_not_counted_but_a_user_opened_one_is() {
        let temp = TempDir::new("telemetry-restore");
        let restored = temp.path().join("restored");
        let mine = temp.path().join("mine");
        fs::create_dir(&restored).unwrap();
        fs::create_dir(&mine).unwrap();
        let (app, logger) = store_app(Settings {
            last_workspace: Some(canonical(&restored)),
            recent_folders: vec![canonical(&restored)],
            ..Settings::default()
        });

        restore_last_workspace(app.handle(), || true);
        assert!(
            app.state::<AppState>().scope_id().is_some(),
            "復元できていない"
        );
        assert!(logger.sent().is_empty(), "復元を数えた");

        open_path(app.handle(), &mine).expect("開けない");
        assert_eq!(logger.sent(), ["open_folder"]);
    }

    /// 開けなかったときは記録しない。成功したときも、1セッションに1回だけ記録する。
    #[test]
    fn open_folder_is_recorded_for_a_success_and_only_once() {
        let temp = TempDir::new("telemetry-open");
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir(&first).unwrap();
        fs::create_dir(&second).unwrap();
        let (app, logger) = store_app(Settings::default());

        assert!(open_path(app.handle(), &temp.path().join("missing")).is_err());
        assert!(logger.sent().is_empty(), "失敗を数えた");

        open_path(app.handle(), &first).expect("開けない");
        open_path(app.handle(), &second).expect("開けない");
        assert_eq!(logger.sent(), ["open_folder"]);
    }

    /// 起動時は、最後のワークスペースを開き直す（9.2）。
    #[test]
    fn the_last_workspace_is_reopened_at_startup() {
        let temp = TempDir::new("restore");
        let app = app_with(Settings {
            last_workspace: Some(canonical(temp.path())),
            recent_folders: vec![canonical(temp.path())],
            ..Settings::default()
        });
        let opened = collect(&app, WORKSPACE_OPENED_EVENT);

        restore_last_workspace(app.handle(), || true);

        assert!(app.state::<AppState>().scope_id().is_some());
        assert_eq!(opened.lock().unwrap().len(), 1);
    }

    /// 開き直せないフォルダーは、welcome状態のまま起動し、最近使ったフォルダーからも外す。
    /// 起動のたびに失敗を示しても、利用者が取れる行動がない（9.2）。
    #[test]
    fn a_last_workspace_that_cannot_be_opened_is_dropped_silently() {
        let temp = TempDir::new("restore-missing");
        let missing = canonical(temp.path()) + "\\gone";
        let kept = canonical(temp.path());
        let app = app_with(Settings {
            last_workspace: Some(missing.clone()),
            recent_folders: vec![missing, kept.clone()],
            ..Settings::default()
        });
        let opened = collect(&app, WORKSPACE_OPENED_EVENT);
        let changed = collect(&app, RECENT_FOLDERS_CHANGED_EVENT);

        restore_last_workspace(app.handle(), || true);

        assert!(app.state::<AppState>().scope_id().is_none());
        assert!(opened.lock().unwrap().is_empty());
        let settings = app.state::<SettingsStore>().settings();
        assert_eq!(settings.last_workspace, None);
        assert_eq!(settings.recent_folders, [kept]);
        assert_eq!(changed.lock().unwrap().len(), 1);
    }

    /// 最後のワークスペースが無ければ、何も開かない。
    #[test]
    fn nothing_is_restored_without_a_last_workspace() {
        let app = app_with(Settings::default());
        let opened = collect(&app, WORKSPACE_OPENED_EVENT);

        restore_last_workspace(app.handle(), || true);

        assert!(app.state::<AppState>().scope_id().is_none());
        assert!(opened.lock().unwrap().is_empty());
    }

    /// 復元が最後のワークスペースを読んだあとに、利用者が閉じる操作を終えても、閉じたものを
    /// 開き直さない。復元は、フォルダーを開いたあとに、開閉のロックの内側で最後のワークスペース
    /// を読み直して判断する。
    ///
    /// 開閉のロックを保持したまま復元を始めて、判断の手前で待たせる。その間に閉じる操作の結果
    /// （最後のワークスペースを消す）を再現してからロックを放すと、復元は消えたあとの値を読む。
    /// 最初の（ロックの外の）読みだけで判断する実装では、その古いパスを開き直して、このテストが
    /// 失敗する。
    #[test]
    fn a_close_finished_before_the_restore_decides_wins() {
        let temp = TempDir::new("restore-close-race");
        let app = app_with(Settings {
            last_workspace: Some(canonical(temp.path())),
            recent_folders: vec![canonical(temp.path())],
            ..Settings::default()
        });
        let opened = collect(&app, WORKSPACE_OPENED_EVENT);
        let guard = lock_lifecycle();
        let handle = app.handle().clone();
        let restoring = thread::spawn(move || restore_last_workspace(&handle, || true));
        // 復元のスレッドが、ロックを待つところまで進む。
        thread::sleep(std::time::Duration::from_millis(100));

        // 閉じる操作が、ロックの内側で終えること。
        app.state::<SettingsStore>().clear_last_workspace();
        drop(guard);
        restoring.join().expect("復元のスレッドが失敗した");

        assert!(app.state::<AppState>().scope_id().is_none());
        assert!(opened.lock().unwrap().is_empty());
    }

    /// 復元が終わる前に利用者が別のフォルダーを開いていたときは、それを上書きしない。
    #[test]
    fn restoring_does_not_replace_a_workspace_opened_meanwhile() {
        let temp = TempDir::new("restore-race");
        let mine = temp.path().join("mine");
        let last = temp.path().join("last");
        fs::create_dir(&mine).unwrap();
        fs::create_dir(&last).unwrap();
        let app = app_with(Settings::default());
        open_path(app.handle(), &mine).expect("開けない");
        let before = app.state::<AppState>().scope_id();
        app.state::<SettingsStore>()
            .record_opened_workspace(&canonical(&last));

        restore_last_workspace(app.handle(), || true);

        assert_eq!(app.state::<AppState>().scope_id(), before);
    }

    /// 復元が据えるのは、開けたフォルダーで、待ちを取りやめていないときだけ。開けなかった
    /// フォルダーは、取りやめたかどうかによらず外す。取りやめたときは、開けても記録を残し、
    /// 次の起動でもう一度試す（9.2）。据えてよいかは、据える直前にだけ尋ねる。
    #[test]
    fn a_restore_installs_only_what_opened_and_was_not_given_up() {
        struct Case {
            name: &'static str,
            exists: bool,
            may_commit: bool,
            installed: bool,
            kept: bool,
            asked: bool,
        }
        let cases = [
            Case {
                name: "開けて、取りやめていない",
                exists: true,
                may_commit: true,
                installed: true,
                kept: true,
                asked: true,
            },
            Case {
                name: "開けたが、取りやめた",
                exists: true,
                may_commit: false,
                installed: false,
                kept: true,
                asked: true,
            },
            Case {
                name: "開けず、取りやめていない",
                exists: false,
                may_commit: true,
                installed: false,
                kept: false,
                asked: false,
            },
            Case {
                name: "開けず、取りやめた",
                exists: false,
                may_commit: false,
                installed: false,
                kept: false,
                asked: false,
            },
        ];
        for (index, case) in cases.iter().enumerate() {
            let temp = TempDir::new(&format!("restore-commit-{index}"));
            let path = if case.exists {
                canonical(temp.path())
            } else {
                canonical(temp.path()) + "\\gone"
            };
            let app = app_with(Settings {
                last_workspace: Some(path.clone()),
                recent_folders: vec![path.clone()],
                ..Settings::default()
            });
            let opened = collect(&app, WORKSPACE_OPENED_EVENT);
            let asked = std::cell::Cell::new(false);

            restore_last_workspace(app.handle(), || {
                asked.set(true);
                case.may_commit
            });

            let name = case.name;
            assert_eq!(asked.get(), case.asked, "{name}: 尋ねたか");
            assert_eq!(
                app.state::<AppState>().scope_id().is_some(),
                case.installed,
                "{name}: 据えたか"
            );
            assert_eq!(
                opened.lock().unwrap().len(),
                usize::from(case.installed),
                "{name}"
            );
            let settings = app.state::<SettingsStore>().settings();
            assert_eq!(
                settings.last_workspace.is_some(),
                case.kept,
                "{name}: 最後のワークスペースの記録"
            );
            assert_eq!(
                settings.recent_folders.is_empty(),
                !case.kept,
                "{name}: 最近使ったフォルダー"
            );
        }
    }

    /// フォルダーを開いている間、開閉のロックを保持しない。保持すると、ロックを待つ
    /// `get_workspace_command` が返らず、Frontendの準備が済まないため、関連付けで渡された
    /// ファイルが開けない（9.2）。
    ///
    /// フォルダーを開く段階を、放すまで止める。その間に、ロックを取る問い合わせと、利用者の
    /// 「フォルダーを開く」が進み、復元は利用者が開いたものを上書きしない。
    #[test]
    fn the_lifecycle_lock_is_free_while_the_restore_waits_for_the_folder() {
        use std::sync::mpsc;
        use std::time::Duration;

        let temp = TempDir::new("restore-slow-open");
        let last = temp.path().join("last");
        let mine = temp.path().join("mine");
        fs::create_dir(&last).unwrap();
        fs::create_dir(&mine).unwrap();
        let app = app_with(Settings {
            last_workspace: Some(canonical(&last)),
            recent_folders: vec![canonical(&last)],
            ..Settings::default()
        });
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let handle = app.handle().clone();
        let restoring = thread::spawn(move || {
            restore_with(
                &handle,
                move |path| {
                    entered_tx.send(()).expect("入ったことを知らせられない");
                    release_rx.recv().expect("放す合図が来ない");
                    WorkspaceRoot::open(path)
                },
                || true,
            );
        });
        entered_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("復元がフォルダーを開く段階へ進まない");

        // 止まっている間も、ロックを取る問い合わせと、利用者の操作は待たされない。
        let (done_tx, done_rx) = mpsc::channel();
        let handle = app.handle().clone();
        let user = thread::spawn(move || {
            let queried = current_workspace(&handle);
            let opened = open_path(&handle, &mine);
            done_tx.send((queried, opened)).expect("結果を返せない");
        });
        let (queried, opened) = done_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("フォルダーを開いている間、開閉のロックを保持している");
        assert_eq!(queried, None);
        assert_eq!(opened, Ok(()));
        user.join().expect("利用者の操作のスレッドが失敗した");
        let mine_scope = app.state::<AppState>().scope_id();
        assert!(mine_scope.is_some());

        release_tx.send(()).expect("放せない");
        restoring.join().expect("復元のスレッドが失敗した");
        assert_eq!(
            app.state::<AppState>().scope_id(),
            mine_scope,
            "利用者が開いたものを上書きした"
        );
    }

    /// フォルダーを開く段階で止まった復元の間に、`meanwhile` を別のスレッドで行い、その結果を
    /// 返してから復元を進める。`meanwhile` が2秒で戻らなければ、開閉のロックを保持しているとみなす。
    fn restore_interrupted_by<T: Send + 'static>(
        app: &tauri::App<tauri::test::MockRuntime>,
        open_root: fn(&Path) -> io::Result<WorkspaceRoot>,
        meanwhile: impl FnOnce(&AppHandle<tauri::test::MockRuntime>) -> T + Send + 'static,
    ) -> T {
        use std::sync::mpsc;
        use std::time::Duration;

        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let handle = app.handle().clone();
        let restoring = thread::spawn(move || {
            restore_with(
                &handle,
                move |path| {
                    entered_tx.send(()).expect("入ったことを知らせられない");
                    release_rx.recv().expect("放す合図が来ない");
                    open_root(path)
                },
                || true,
            );
        });
        entered_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("復元がフォルダーを開く段階へ進まない");

        let (done_tx, done_rx) = mpsc::channel();
        let handle = app.handle().clone();
        thread::spawn(move || {
            done_tx.send(meanwhile(&handle)).expect("結果を返せない");
        });
        let result = done_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("フォルダーを開いている間、開閉のロックを保持している");

        release_tx.send(()).expect("放せない");
        restoring.join().expect("復元のスレッドが失敗した");
        result
    }

    /// フォルダーを開いている間に、ファイルだけをドロップして開いたloose tabを、復元が破棄しない。
    /// ワークスペースを据える切り替えは、開いているloose tabとその監視を破棄する（6.1）。
    /// `scope_id()` はワークスペースの監視だけを見るため、それだけで判断すると、利用者が開いた
    /// 文書が失われる。文書を開くのを優先し、復元は見送る。記録は残し、次の起動でもう一度試す。
    #[test]
    fn a_document_dropped_while_the_restore_waits_is_not_discarded() {
        let temp = TempDir::new("restore-drop");
        let last = temp.path().join("last");
        let elsewhere = temp.path().join("elsewhere");
        fs::create_dir(&last).unwrap();
        fs::create_dir(&elsewhere).unwrap();
        let note = elsewhere.join("note.md");
        fs::write(&note, b"# note\n").unwrap();
        let app = app_with(Settings {
            last_workspace: Some(canonical(&last)),
            recent_folders: vec![canonical(&last)],
            ..Settings::default()
        });
        let documents = collect(&app, crate::open_document::OPEN_DOCUMENT_EVENT);
        let workspaces = collect(&app, WORKSPACE_OPENED_EVENT);

        let dropped = restore_interrupted_by(&app, WorkspaceRoot::open, move |handle| {
            crate::open_document::open_document(handle, &note)
        });

        assert_eq!(dropped, Ok(()));
        let payloads = documents.lock().unwrap().clone();
        assert_eq!(payloads.len(), 1);
        let opened: crate::ipc::types::OpenDocumentEvent =
            serde_json::from_str(&payloads[0]).expect("指示を解釈できない");
        assert!(
            app.state::<AppState>()
                .workspace()
                .with_scope(&opened.scope_id, |_| ())
                .is_some(),
            "復元が、利用者が開いた文書のスコープを破棄した"
        );
        assert!(app.state::<AppState>().scope_id().is_none());
        assert!(workspaces.lock().unwrap().is_empty(), "復元を据えた");
        let settings = app.state::<SettingsStore>().settings();
        assert_eq!(settings.last_workspace, Some(canonical(&last)));
        assert_eq!(settings.recent_folders, [canonical(&last)]);
    }

    /// 開けなかったフォルダーは、利用者が文書を開いていても外す。据えない理由（利用者が開いた
    /// ものを残す）と、外す理由（開けない記録を残しても取れる行動がない、9.2）は別である。
    #[test]
    fn an_unopenable_last_workspace_is_dropped_even_when_a_document_is_open() {
        let temp = TempDir::new("restore-drop-missing");
        let missing = canonical(temp.path()) + "\\gone";
        let note = temp.path().join("note.md");
        fs::write(&note, b"# note\n").unwrap();
        let app = app_with(Settings {
            last_workspace: Some(missing.clone()),
            recent_folders: vec![missing],
            ..Settings::default()
        });
        let documents = collect(&app, crate::open_document::OPEN_DOCUMENT_EVENT);

        let dropped = restore_interrupted_by(&app, WorkspaceRoot::open, move |handle| {
            crate::open_document::open_document(handle, &note)
        });

        assert_eq!(dropped, Ok(()));
        assert_eq!(documents.lock().unwrap().len(), 1);
        assert!(app.state::<AppState>().has_open_scope(), "文書が失われた");
        let settings = app.state::<SettingsStore>().settings();
        assert_eq!(settings.last_workspace, None);
        assert!(settings.recent_folders.is_empty());
    }

    /// 文書を開いてある状態では、フォルダーを開く待ちを始めない。据えられないのに、応答しない
    /// 共有へ接続を試みる必要がない。記録は残す。
    #[test]
    fn the_restore_does_not_start_while_a_document_is_open() {
        let temp = TempDir::new("restore-skip");
        let last = temp.path().join("last");
        fs::create_dir(&last).unwrap();
        let note = temp.path().join("note.md");
        fs::write(&note, b"# note\n").unwrap();
        let app = app_with(Settings {
            last_workspace: Some(canonical(&last)),
            recent_folders: vec![canonical(&last)],
            ..Settings::default()
        });
        crate::open_document::open_document(app.handle(), &note).expect("開けない");
        let asked = std::cell::Cell::new(false);

        restore_with(
            app.handle(),
            |path| {
                asked.set(true);
                WorkspaceRoot::open(path)
            },
            || true,
        );

        assert!(
            !asked.get(),
            "文書を開いてあるのに、フォルダーを開こうとした"
        );
        assert!(app.state::<AppState>().scope_id().is_none());
        assert_eq!(
            app.state::<SettingsStore>().settings().last_workspace,
            Some(canonical(&last))
        );
    }

    /// 開いているワークスペースを問い合わせられる。開いていなければ `None` を返す。
    #[test]
    fn the_current_workspace_can_be_queried() {
        let temp = TempDir::new("query");
        let app = app_with(Settings::default());
        assert_eq!(current_workspace(app.handle()), None);

        open_path(app.handle(), temp.path()).expect("開けない");

        let current = current_workspace(app.handle()).expect("開いているはず");
        assert_eq!(
            Some(current.scope_id.clone()),
            app.state::<AppState>().scope_id()
        );
        assert!(
            !current.label.contains(':'),
            "絶対パスを含む: {}",
            current.label
        );
    }

    /// 閉じたワークスペースは、次の起動で開き直さない。最近使ったフォルダーには残す。
    #[test]
    fn closing_clears_the_last_workspace_but_keeps_it_recent() {
        let temp = TempDir::new("close-clears");
        let app = app_with(Settings::default());
        open_path(app.handle(), temp.path()).expect("開けない");

        close(app.handle()).join().expect("閉じる処理が失敗した");

        let settings = app.state::<SettingsStore>().settings();
        assert_eq!(settings.last_workspace, None);
        assert_eq!(settings.recent_folders, [canonical(temp.path())]);
    }

    /// 開けなかった場合は理由を返し、現在のワークスペースを保つ。
    #[test]
    fn a_missing_folder_is_reported_and_keeps_the_workspace() {
        let temp = TempDir::new("missing");
        let state = AppState::new(LanguagePreference::System);
        let current =
            open_selected_folder(&state, temp.path(), Arc::new(DiscardingSink)).expect("開けない");

        let error = open_selected_folder(
            &state,
            &temp.path().join("missing"),
            Arc::new(DiscardingSink),
        )
        .expect_err("存在しないフォルダーを開けた");

        assert_eq!(error, ErrorCode::WorkspaceNotFound);
        assert_eq!(state.scope_id(), Some(current.scope_id));
    }

    #[test]
    fn open_errors_map_to_workspace_codes() {
        let cases = [
            (io::ErrorKind::NotFound, ErrorCode::WorkspaceNotFound),
            (
                io::ErrorKind::PermissionDenied,
                ErrorCode::WorkspaceAccessDenied,
            ),
            (
                io::ErrorKind::NotADirectory,
                ErrorCode::WorkspaceAccessDenied,
            ),
            // 監視を開始できない場合（`io::Error::other` で包まれる）。
            (io::ErrorKind::Other, ErrorCode::WorkspaceAccessDenied),
        ];
        for (kind, expected) in cases {
            assert_eq!(
                open_error_code(&io::Error::from(kind)),
                expected,
                "{kind:?}"
            );
        }
    }
}
