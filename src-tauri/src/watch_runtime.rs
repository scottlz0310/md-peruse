//! Watcherのライフサイクル、監視スコープの採番、確定した変更の送出（design-decisions.md 6.4）。
//!
//! イベントの写像、畳み込み、窓の時間規則は `crate::watch` を正本とする。ここが持つのは
//! 実際の監視と時刻であり、規則そのものは持たない。`crate::watch` が時計を読まないのは、
//! 窓の時間規則を実時間なしに検証するためである（14.2）。時計を読むのはこのモジュールに限る。

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use notify::event::{EventKind, ModifyKind, RenameMode};
use notify::{Event, RecursiveMode, Watcher};
use tauri::{Emitter, Manager};

use crate::file_kind::is_markdown_path;
use crate::i18n::Language;
use crate::image::resource::ImageResources;
use crate::ipc::error::{ErrorCode, IpcError};
use crate::ipc::message::message;
use crate::ipc::types::{FileChangeEvent, WatcherErrorEvent};
use crate::scan::is_excluded_directory;
use crate::state::AppState;
use crate::watch::{DebounceWindow, WindowOutcome, coalesce, map_event};

/// 確定した変更を運ぶTauri eventの名前。
pub const FILE_CHANGE_EVENT: &str = "file-change";

/// 監視が追従できなくなったことを運ぶTauri eventの名前。
pub const WATCHER_ERROR_EVENT: &str = "watcher-error";

/// 確定した変更の送出先。
///
/// `tauri::AppHandle` を直接持たず抽象を挟むのは、Watcherのライフサイクルと送出の内容を
/// Tauriのアプリインスタンスなしで検証するためである（14.2）。実装は2つあり、製品では
/// `TauriChangeSink`、テストでは送出を記録するものを使う。
pub trait ChangeSink: Send + Sync + 'static {
    /// 確定した変更を送る。
    fn file_change(&self, event: FileChangeEvent);

    /// 監視が追従できなくなったことを送る。
    ///
    /// `IpcError` ではなく `ErrorCode` を渡すのは、文言を送出の時点のUI言語で組み立てる
    /// ためである（10.5）。Watcherはワークスペースを開いている間ずっと生きるため、開始時の
    /// 言語で文言を作ると、言語を切り替えた後もずっと旧言語で届く。
    fn watcher_error(&self, scope_id: &str, code: ErrorCode);
}

/// 監視スコープのIDを採番する。
///
/// プロセス内でのみ有効な不透明値であり、絶対パスを含まない（7.1）。連番にしないのは、
/// 別のスコープのIDを推測できてしまい、Frontendがスコープの一致で通知先を絞る意味が
/// 弱くなるためである。`rand` を足さずに `RandomState` を使う。標準ライブラリがOSの
/// エントロピーで鍵を初期化するため、呼び出しごとに異なる値になる。連番を混ぜるのは、
/// 万一同じ鍵が引かれても同一プロセス内で衝突しないようにするためである。
fn new_scope_id() -> String {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    // `hash_of` は呼ぶたびに別の鍵を引く。2回呼んで128ビットにする。
    format!("{:016x}{:016x}", hash_of(sequence), hash_of(sequence))
}

fn hash_of(value: u64) -> u64 {
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u64(value);
    hasher.finish()
}

/// ワークスペースのルート以下を監視するWatcher（design-decisions.md 6.4）。
///
/// 実体は2つのWatcherと1つのスレッドである。ルートの再帰監視に加えてルートの親を非再帰で
/// 監視するのは、ルート自身の削除とrenameがそのルートのWatcherには届かないためである
/// （6.4の実測）。スレッドは窓の期限まで待ち、期限が来たら確定した変更を送出する。
pub struct WorkspaceWatcher {
    scope_id: String,
    /// 監視スレッドへの送信端。停止の指示に使う。
    ///
    /// 送信端はnotifyのコールバックも持つため、これを落としても `recv` は切れない。
    /// 停止は必ず `Incoming::Stop` を送って伝える。
    commands: Sender<Incoming>,
    thread: Option<JoinHandle<()>>,
}

/// 監視スレッドが受け取るもの。
enum Incoming {
    /// ルートの再帰監視から届いたイベント。
    Root(Event),
    /// ルートの親の非再帰監視から届いたイベント。
    Parent(Event),
    /// 停止の指示。
    Stop,
}

impl WorkspaceWatcher {
    /// 監視を開始する。
    ///
    /// 走査の完了を待たずに開始する。走査中に起きた変更を取りこぼさないためである（6.4）。
    ///
    /// `images` は同じワークスペースの画像resource IDである。変更を受けたパスの世代を進め、
    /// 窓が縮退したときは作り直す（5.4）。
    pub fn start(
        root: &Path,
        sink: Arc<dyn ChangeSink>,
        images: Arc<ImageResources>,
    ) -> notify::Result<Self> {
        let scope_id = new_scope_id();
        let (commands, incoming) = channel();

        let mut root_watcher = forwarding_watcher(commands.clone(), Incoming::Root)?;
        root_watcher.watch(root, RecursiveMode::Recursive)?;

        // 親を監視できないのはルートがドライブ直下のときである（`parent` が `None`）。
        // この場合だけ `WatcherStopped` の検知経路を持たない（6.4）。
        let parent_watcher = match root.parent() {
            Some(parent) => {
                let mut watcher = forwarding_watcher(commands.clone(), Incoming::Parent)?;
                // 再帰にするとルート配下のイベントを二重に受ける。
                watcher.watch(parent, RecursiveMode::NonRecursive)?;
                Some(watcher)
            }
            None => None,
        };

        let root = root.to_path_buf();
        let thread_scope_id = scope_id.clone();
        let thread = std::thread::Builder::new()
            .name("md-peruse-watch".to_owned())
            .spawn(move || {
                // Watcherはこのスレッドが終わるまで生かす。dropした時点で監視が止まる。
                let _root_watcher = root_watcher;
                let _parent_watcher = parent_watcher;
                run(
                    &root,
                    &thread_scope_id,
                    sink.as_ref(),
                    images.as_ref(),
                    &incoming,
                );
            })?;

        Ok(Self {
            scope_id,
            commands,
            thread: Some(thread),
        })
    }

    /// このWatcherが送出するイベントのスコープID。
    pub fn scope_id(&self) -> &str {
        &self.scope_id
    }
}

impl Drop for WorkspaceWatcher {
    /// 監視を止め、スレッドの終了を待つ。
    ///
    /// 待つのは、ワークスペースの切り替えで「旧Watcherを停止してから状態を破棄する」
    /// ことを保証するためである（6.4）。待たずに戻ると、停止を指示した後にまだ生きている
    /// 旧スレッドが、新しいワークスペースの状態へ適用されうるイベントを送出する。
    fn drop(&mut self) {
        // スレッドが先に終わっている場合（`WatcherStopped` の送出後）は受信端が落ちており
        // 送信に失敗する。停止済みなので何もしなくてよい。
        let _ = self.commands.send(Incoming::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// 受け取ったイベントを `Incoming` へ包んで送るWatcherを作る。
fn forwarding_watcher(
    sender: Sender<Incoming>,
    wrap: fn(Event) -> Incoming,
) -> notify::Result<notify::RecommendedWatcher> {
    notify::recommended_watcher(move |result: notify::Result<Event>| {
        // 受信端が落ちているのは監視スレッドが終わった後であり、送る先がない。
        if let Ok(event) = result {
            let _ = sender.send(wrap(event));
        }
    })
}

/// 監視スレッドの本体。
fn run(
    root: &Path,
    scope_id: &str,
    sink: &dyn ChangeSink,
    images: &ImageResources,
    incoming: &Receiver<Incoming>,
) {
    let origin = Instant::now();
    let mut window = DebounceWindow::new();
    loop {
        match wait(&window, origin, incoming) {
            Wait::Received(Incoming::Stop) | Wait::Disconnected => return,
            Wait::Received(Incoming::Root(event)) => {
                let now_ms = elapsed_ms(origin);
                for raw in map_event(root, &event) {
                    // 画像の世代は窓の確定を待たずに進める。同じ窓で文書の変更が確定すると
                    // 再描画に伴って発行し直されるため、それより前に新しい世代になっている
                    // 必要がある。除外対象配下の画像も文書から参照されうるため、除外の判定
                    // より前に行う。
                    images.advance(&raw.path);
                    // notifyはディレクトリ単位の除外を行えないため、受信後にパスで判定して
                    // 破棄する（6.4）。
                    if is_excluded(&raw.path) {
                        continue;
                    }
                    window.push(now_ms, raw);
                }
            }
            Wait::Received(Incoming::Parent(event)) => {
                if stops_workspace(root, &event) {
                    sink.watcher_error(scope_id, ErrorCode::WatcherStopped);
                    return;
                }
            }
            Wait::Deadline => {}
        }
        drain(&mut window, origin, scope_id, sink, images);
    }
}

enum Wait {
    Received(Incoming),
    Deadline,
    Disconnected,
}

/// 窓の期限まで待つ。窓が開いていなければイベントが届くまで待つ。
fn wait(window: &DebounceWindow, origin: Instant, incoming: &Receiver<Incoming>) -> Wait {
    let Some(deadline_ms) = window.deadline_ms() else {
        return match incoming.recv() {
            Ok(received) => Wait::Received(received),
            Err(_) => Wait::Disconnected,
        };
    };
    let remaining = Duration::from_millis(deadline_ms.saturating_sub(elapsed_ms(origin)));
    match incoming.recv_timeout(remaining) {
        Ok(received) => Wait::Received(received),
        Err(RecvTimeoutError::Timeout) => Wait::Deadline,
        Err(RecvTimeoutError::Disconnected) => Wait::Disconnected,
    }
}

/// 期限に達した窓を確定させて送出する。
///
/// 1回では終わらない。窓を閉じるとき、猶予中の保留に関わるイベントは次の窓へ持ち越すため
/// （6.4）、持ち越した窓の期限も既に過ぎていることがある。期限は持ち越しのたびに必ず前へ
/// 進むため（`DebounceWindow::take_due`）、この繰り返しは止まる。
///
/// 縮退した窓では画像resource IDを作り直す。取りこぼした変更の世代は進んでおらず、
/// 縮退を受けた再描画で古い画像がキャッシュから表示されるためである（5.4）。通知より前に
/// 作り直す。
fn drain(
    window: &mut DebounceWindow,
    origin: Instant,
    scope_id: &str,
    sink: &dyn ChangeSink,
    images: &ImageResources,
) {
    while let Some(outcome) = window.take_due(elapsed_ms(origin)) {
        match outcome {
            WindowOutcome::Events(events) => {
                for change in coalesce(&events, is_markdown_path) {
                    sink.file_change(FileChangeEvent {
                        scope_id: scope_id.to_owned(),
                        change,
                    });
                }
            }
            WindowOutcome::Overflowed => {
                images.reset();
                sink.watcher_error(scope_id, ErrorCode::WatcherOverflow);
            }
        }
    }
}

fn elapsed_ms(origin: Instant) -> u64 {
    // 単調増加するミリ秒であればよい（`DebounceWindow` の契約）。u64のミリ秒は
    // 5億年を超えるまで飽和しない。
    origin.elapsed().as_millis() as u64
}

/// 除外対象のフォルダー配下かを、スコープ相対パスの字面で判定する。
///
/// 属性による除外（隠し、システム、reparse point。6.2）はここでは行わない。削除された
/// パスの属性は引けず、判定できるものとできないものが混在すると、同じファイルが作成時と
/// 削除時で違う扱いになる。名前による除外だけは字面で一貫して判定できる。
fn is_excluded(path: &str) -> bool {
    path.split('/').any(is_excluded_directory)
}

/// 親から届いたイベントが、ワークスペースのルートの消失を表すかを判定する。
///
/// ルート自身の削除とrenameは、そのルートを監視するWatcherには届かない（6.4の実測）。
/// 親の非再帰監視では、ルート配下の書込みでも親ディレクトリのタイムスタンプ更新が
/// `Modify(Any)` として大量に届くため、種別で絞る。
fn stops_workspace(root: &Path, event: &Event) -> bool {
    match event.kind {
        EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            event.paths.iter().any(|path| path == root)
        }
        // 1つのイベントが旧パスと新パスの両方を運ぶ場合。`paths` は旧・新の順であり、
        // ルートが旧パスのときだけ消失になる。新パスがルートなのは、別の名前だった
        // フォルダーがルートの名前になった場合であり、ルートは消えていない。
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
            event.paths.first().is_some_and(|path| path == root)
        }
        _ => false,
    }
}

/// 監視の断念を表すイベントを、指定のUI言語で組み立てる。
///
/// 送出から切り離すのは、「文言は送出の時点のUI言語で組み立てる」という契約（10.5）を
/// Tauriのアプリインスタンスなしで固定するためである。
fn watcher_error_event(scope_id: &str, code: ErrorCode, language: Language) -> WatcherErrorEvent {
    WatcherErrorEvent {
        scope_id: scope_id.to_owned(),
        error: IpcError {
            code,
            message: message(code, language).to_owned(),
            detail: None,
        },
    }
}

/// Tauri eventとして送出する `ChangeSink`。
///
/// runtimeを型引数にしているのは、テストで `tauri::test::mock_app` の `MockRuntime` を
/// 渡すためである。`mock_app` が返すのは `AppHandle<MockRuntime>` であり、製品が使う
/// `AppHandle<Wry>` とは別の型になる（14.2）。既定は `Wry` のため、製品側の記述は変わらない。
pub struct TauriChangeSink<R: tauri::Runtime = tauri::Wry> {
    app: tauri::AppHandle<R>,
}

impl<R: tauri::Runtime> TauriChangeSink<R> {
    pub fn new(app: tauri::AppHandle<R>) -> Self {
        Self { app }
    }

    /// 送出の失敗は捨てる。
    ///
    /// 監視スレッドから呼ばれるため、伝播させる先がない。失敗するのはWebViewが閉じた後で
    /// あり、そのときは受け手がいないので伝えるべき相手もいない。監視を止める理由にも
    /// ならない。
    fn emit(&self, name: &str, payload: impl serde::Serialize + Clone) {
        let _ = self.app.emit(name, payload);
    }
}

impl<R: tauri::Runtime> ChangeSink for TauriChangeSink<R> {
    fn file_change(&self, event: FileChangeEvent) {
        self.emit(FILE_CHANGE_EVENT, event);
    }

    fn watcher_error(&self, scope_id: &str, code: ErrorCode) {
        // 言語はここで引く。Watcherはワークスペースを開いている間ずっと生きるため、
        // 開始時の言語を捕まえると切り替えた後もずっと旧言語で届く（10.5）。
        let language = self.app.state::<AppState>().language();
        self.emit(
            WATCHER_ERROR_EVENT,
            watcher_error_event(scope_id, code, language),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watch::{MAX_EVENTS_PER_WINDOW, MAX_WINDOW_MS, RawEvent, RawEventKind};
    use std::path::PathBuf;
    use std::sync::Mutex;
    use tauri::Listener;

    /// 送出を記録する `ChangeSink`。
    #[derive(Default)]
    struct RecordingSink {
        changes: Mutex<Vec<FileChangeEvent>>,
        errors: Mutex<Vec<(String, ErrorCode)>>,
    }

    impl RecordingSink {
        fn changes(&self) -> Vec<FileChangeEvent> {
            self.changes.lock().expect("記録のロックに失敗").clone()
        }

        fn errors(&self) -> Vec<(String, ErrorCode)> {
            self.errors.lock().expect("記録のロックに失敗").clone()
        }
    }

    impl ChangeSink for RecordingSink {
        fn file_change(&self, event: FileChangeEvent) {
            self.changes.lock().expect("記録のロックに失敗").push(event);
        }

        fn watcher_error(&self, scope_id: &str, code: ErrorCode) {
            self.errors
                .lock()
                .expect("記録のロックに失敗")
                .push((scope_id.to_owned(), code));
        }
    }

    /// テスト用の一時フォルダー。終了時に削除する。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "md-peruse-watch-{name}-{}-{}",
                std::process::id(),
                new_scope_id()
            ));
            std::fs::create_dir_all(&path).expect("一時フォルダーの作成に失敗");
            Self(std::fs::canonicalize(&path).expect("一時フォルダーの正規化に失敗"))
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// 監視の送出だけを確かめるテストに渡す、空の画像resource ID。
    fn images() -> Arc<ImageResources> {
        Arc::new(ImageResources::new())
    }

    /// 条件が満たされるまで待つ。実イベントの到達は時間に依存するため、固定の待ちでは
    /// 落ちやすい。上限は実測（1回の窓は最長600 ms）に対して十分長く採る。
    fn wait_until<T>(mut poll: impl FnMut() -> Option<T>) -> Option<T> {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if let Some(value) = poll() {
                return Some(value);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        None
    }

    fn notify_event(kind: EventKind, paths: &[&Path]) -> Event {
        Event {
            kind,
            paths: paths.iter().map(|path| path.to_path_buf()).collect(),
            attrs: notify::event::EventAttributes::new(),
        }
    }

    #[test]
    fn scope_ids_do_not_repeat() {
        let ids: Vec<String> = (0..64).map(|_| new_scope_id()).collect();
        let mut unique = ids.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), ids.len(), "スコープIDが重複している");
        // 絶対パスもパス断片も含まない不透明値であること。
        assert!(ids.iter().all(|id| id.len() == 32 && id.is_ascii()));
    }

    #[test]
    fn excluded_directories_are_dropped() {
        let cases: [(&str, bool); 6] = [
            ("a.md", false),
            ("docs/a.md", false),
            ("node_modules/a.md", true),
            ("docs/node_modules/deep/a.md", true),
            // 除外は名前で判定するため、大文字小文字は区別しない（走査と同じ）。
            ("NODE_MODULES/a.md", true),
            ("node_modules_extra/a.md", false),
        ];
        for (path, expected) in cases {
            assert_eq!(is_excluded(path), expected, "{path}");
        }
    }

    #[test]
    fn parent_events_that_stop_the_workspace_are_classified() {
        let root = Path::new(r"\\?\C:\ws");
        let sibling = Path::new(r"\\?\C:\other");
        let renamed = Path::new(r"\\?\C:\ws-renamed");
        let cases: [(&str, Event, bool); 6] = [
            (
                "ルートの削除は停止",
                notify_event(EventKind::Remove(notify::event::RemoveKind::Any), &[root]),
                true,
            ),
            (
                "ルートのrename元は停止",
                notify_event(
                    EventKind::Modify(ModifyKind::Name(RenameMode::From)),
                    &[root],
                ),
                true,
            ),
            (
                "旧パスがルートのBothは停止",
                notify_event(
                    EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                    &[root, renamed],
                ),
                true,
            ),
            (
                // 別のフォルダーがルートの名前になっただけで、ルートは消えていない。
                "新パスがルートのBothは停止させない",
                notify_event(
                    EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                    &[sibling, root],
                ),
                false,
            ),
            (
                // ルート配下の書込みで親のタイムスタンプが更新され続ける（実測）。
                "ルートのタイムスタンプ更新は停止させない",
                notify_event(EventKind::Modify(ModifyKind::Any), &[root]),
                false,
            ),
            (
                "兄弟フォルダーの削除は停止させない",
                notify_event(
                    EventKind::Remove(notify::event::RemoveKind::Any),
                    &[sibling],
                ),
                false,
            ),
        ];
        for (name, event, expected) in cases {
            assert_eq!(stops_workspace(root, &event), expected, "{name}");
        }
    }

    #[test]
    fn a_created_markdown_is_reported_with_its_directory() {
        let temp = TempDir::new("created");
        let sink = Arc::new(RecordingSink::default());
        let watcher = WorkspaceWatcher::start(temp.path(), sink.clone(), images())
            .expect("監視を開始できない");

        std::fs::write(temp.path().join("a.md"), b"# a\n").expect("書込みに失敗");

        let changes = wait_until(|| {
            let changes = sink.changes();
            changes.len().ge(&2).then_some(changes)
        })
        .expect("変更が届かない");

        assert!(
            changes
                .iter()
                .all(|event| event.scope_id == watcher.scope_id())
        );
        let kinds: Vec<&crate::ipc::types::FileChange> =
            changes.iter().map(|event| &event.change).collect();
        assert!(
            kinds.contains(&&crate::ipc::types::FileChange::FileModified {
                path: "a.md".to_owned()
            }),
            "{kinds:?}"
        );
        assert!(
            kinds.contains(&&crate::ipc::types::FileChange::DirectoryChanged {
                path: String::new()
            }),
            "{kinds:?}"
        );
        assert!(sink.errors().is_empty());
    }

    /// 除外対象配下の変更は通知しない（6.4）。
    #[test]
    fn changes_under_excluded_directories_are_dropped() {
        let temp = TempDir::new("excluded");
        let excluded = temp.path().join("node_modules");
        std::fs::create_dir(&excluded).expect("フォルダーの作成に失敗");
        let sink = Arc::new(RecordingSink::default());
        let _watcher = WorkspaceWatcher::start(temp.path(), sink.clone(), images())
            .expect("監視を開始できない");

        std::fs::write(excluded.join("a.md"), b"# a\n").expect("書込みに失敗");
        // 除外対象の外にも書き、そちらが届いたことで「窓が閉じた」ことを確かめる。
        // 何も届かないことを待ち時間だけで判定すると、単に遅いだけの場合と区別できない。
        std::fs::write(temp.path().join("b.md"), b"# b\n").expect("書込みに失敗");

        wait_until(|| {
            sink.changes()
                .iter()
                .any(|event| {
                    matches!(
                        &event.change,
                        crate::ipc::types::FileChange::FileModified { path } if path == "b.md"
                    )
                })
                .then_some(())
        })
        .expect("除外対象外の変更が届かない");

        let paths: Vec<String> = sink
            .changes()
            .iter()
            .map(|event| match &event.change {
                crate::ipc::types::FileChange::FileModified { path }
                | crate::ipc::types::FileChange::FileRemoved { path }
                | crate::ipc::types::FileChange::FileRenamed { path, .. }
                | crate::ipc::types::FileChange::DirectoryChanged { path } => path.clone(),
            })
            .collect();
        assert!(
            paths.iter().all(|path| !path.contains("node_modules")),
            "{paths:?}"
        );
    }

    /// ルート自身の削除を、親の非再帰監視で検知する（6.4）。
    #[test]
    fn removing_the_root_stops_the_watcher() {
        let temp = TempDir::new("root-removed");
        let root = temp.path().join("ws");
        std::fs::create_dir(&root).expect("フォルダーの作成に失敗");
        let root = std::fs::canonicalize(&root).expect("正規化に失敗");
        let sink = Arc::new(RecordingSink::default());
        let watcher =
            WorkspaceWatcher::start(&root, sink.clone(), images()).expect("監視を開始できない");

        std::fs::remove_dir_all(&root).expect("削除に失敗");

        let errors = wait_until(|| {
            let errors = sink.errors();
            (!errors.is_empty()).then_some(errors)
        })
        .expect("ルートの消失が通知されない");
        assert_eq!(
            errors,
            vec![(watcher.scope_id().to_owned(), ErrorCode::WatcherStopped)]
        );
    }

    /// 停止はスレッドの終了まで待つ。待たないと、停止後のイベントが新しい
    /// ワークスペースへ適用されうる（6.4）。
    #[test]
    fn dropping_the_watcher_stops_the_notifications() {
        let temp = TempDir::new("stop");
        let sink = Arc::new(RecordingSink::default());
        let watcher = WorkspaceWatcher::start(temp.path(), sink.clone(), images())
            .expect("監視を開始できない");

        std::fs::write(temp.path().join("a.md"), b"# a\n").expect("書込みに失敗");
        wait_until(|| (!sink.changes().is_empty()).then_some(())).expect("変更が届かない");

        drop(watcher);
        let after_stop = sink.changes().len();

        std::fs::write(temp.path().join("b.md"), b"# b\n").expect("書込みに失敗");
        std::thread::sleep(Duration::from_millis(800));
        assert_eq!(sink.changes().len(), after_stop, "停止後も送出している");
    }

    /// 発行済みの画像を書き換えると、サイズも更新時刻も変わらなくても世代が進む（5.4）。
    ///
    /// 更新時刻とバイト数で世代を作らないのは、この書き換えを識別できないためである。
    /// 画像は通知の対象外（`coalesce` はMarkdownに絞る）だが、世代は進める。
    #[test]
    fn rewriting_an_issued_image_advances_its_generation() {
        let temp = TempDir::new("image-generation");
        let image = temp.path().join("a.png");
        std::fs::write(&image, b"0123456789").expect("書込みに失敗");
        let modified = std::fs::metadata(&image)
            .and_then(|metadata| metadata.modified())
            .expect("更新時刻を読めない");
        let images = images();
        let issued = images.issue("a.png");
        let _watcher = WorkspaceWatcher::start(
            temp.path(),
            Arc::new(RecordingSink::default()),
            Arc::clone(&images),
        )
        .expect("監視を開始できない");

        std::fs::write(&image, b"9876543210").expect("書込みに失敗");
        std::fs::File::options()
            .write(true)
            .open(&image)
            .and_then(|file| file.set_modified(modified))
            .expect("更新時刻を戻せない");
        assert_eq!(
            std::fs::metadata(&image).unwrap().modified().unwrap(),
            modified,
            "テストの前提を満たしていない"
        );

        wait_until(|| images.lookup(&issued).is_none().then_some(()))
            .expect("書き換えで世代が進まない");
        assert_ne!(images.issue("a.png"), issued);
    }

    /// 期限を過ぎた時刻を起点として返す。
    ///
    /// 窓へ渡す時刻は呼び出し側が決める契約（`DebounceWindow`）であり、起点を過去へ
    /// ずらせば実時間を待たずに期限を越えられる。
    fn elapsed_origin(ms: u64) -> Instant {
        Instant::now()
            .checked_sub(Duration::from_millis(ms))
            .expect("起点を過去へずらせない")
    }

    /// 縮退した窓は `WatcherOverflow` として送出し、個別の変更は送らない（6.4）。
    ///
    /// 縮退の結果は展開済みディレクトリの再取得とアクティブ文書の再読込である。個別の
    /// 変更を併せて送ると、Frontendは取りこぼしのある一部の変更を全体だと解釈する。
    #[test]
    fn a_degraded_window_is_reported_as_an_overflow() {
        let mut window = DebounceWindow::new();
        for index in 0..=MAX_EVENTS_PER_WINDOW {
            window.push(
                0,
                RawEvent::new(RawEventKind::Created, &format!("f{index}.md")),
            );
        }
        let sink = RecordingSink::default();
        let images = ImageResources::new();
        let issued = images.issue("a.png");

        drain(
            &mut window,
            elapsed_origin(MAX_WINDOW_MS + 1),
            "scope-1",
            &sink,
            &images,
        );

        assert_eq!(
            sink.errors(),
            vec![("scope-1".to_owned(), ErrorCode::WatcherOverflow)]
        );
        assert!(
            sink.changes().is_empty(),
            "縮退した窓で個別の変更を送っている"
        );
        // 取りこぼした変更の世代は進んでいないため、全IDを作り直す（5.4）。
        assert_eq!(images.lookup(&issued), None, "縮退後も旧IDが有効");
    }

    /// 縮退していない窓は、畳み込んだ変更をスコープIDとともに送る。
    #[test]
    fn a_due_window_is_reported_as_changes() {
        let mut window = DebounceWindow::new();
        window.push(0, RawEvent::new(RawEventKind::Created, "docs/a.md"));
        let sink = RecordingSink::default();
        let images = ImageResources::new();
        let issued = images.issue("a.png");

        drain(
            &mut window,
            elapsed_origin(MAX_WINDOW_MS + 1),
            "scope-2",
            &sink,
            &images,
        );
        // 縮退していなければ対応表は作り直さない。
        assert_eq!(images.lookup(&issued).as_deref(), Some("a.png"));

        assert_eq!(
            sink.changes(),
            vec![
                FileChangeEvent {
                    scope_id: "scope-2".to_owned(),
                    change: crate::ipc::types::FileChange::FileModified {
                        path: "docs/a.md".to_owned()
                    },
                },
                FileChangeEvent {
                    scope_id: "scope-2".to_owned(),
                    change: crate::ipc::types::FileChange::DirectoryChanged {
                        path: "docs".to_owned()
                    },
                },
            ]
        );
        assert!(sink.errors().is_empty());
    }

    /// 断念の文言は渡されたUI言語で組み立てる（10.5）。
    ///
    /// Watcherはワークスペースを開いている間ずっと生きるため、開始時の言語を捕まえる
    /// 実装にすると、言語を切り替えた後もずっと旧言語で届く。ここでは言語ごとに別の
    /// 文言になることだけを固定し、文言そのものは `ipc::message` を正本とする。
    #[test]
    fn the_watcher_error_message_follows_the_language() {
        let japanese = watcher_error_event("scope", ErrorCode::WatcherOverflow, Language::Ja);
        let english = watcher_error_event("scope", ErrorCode::WatcherOverflow, Language::En);

        assert_eq!(japanese.scope_id, "scope");
        assert_eq!(japanese.error.code, ErrorCode::WatcherOverflow);
        assert_eq!(japanese.error.detail, None);
        assert_eq!(
            japanese.error.message,
            message(ErrorCode::WatcherOverflow, Language::Ja)
        );
        assert_ne!(japanese.error.message, english.error.message);
    }

    /// `tauri::test::mock_app` を使い、実際のTauri eventとして届くことを固定する。
    ///
    /// `mock_app` が返すのは `AppHandle<MockRuntime>` であり、製品が使う `AppHandle<Wry>`
    /// とは別の型になる。`TauriChangeSink` をruntimeで型引数化しているのはこのためである。
    #[test]
    fn the_tauri_sink_emits_both_events() {
        let app = tauri::test::mock_app();
        app.manage(AppState::new(crate::i18n::LanguagePreference::En));

        let changes: Arc<Mutex<Vec<FileChangeEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let errors: Arc<Mutex<Vec<WatcherErrorEvent>>> = Arc::new(Mutex::new(Vec::new()));
        {
            let changes = changes.clone();
            app.listen(FILE_CHANGE_EVENT, move |event| {
                changes
                    .lock()
                    .expect("記録のロックに失敗")
                    .push(serde_json::from_str(event.payload()).expect("変更を解釈できない"));
            });
            let errors = errors.clone();
            app.listen(WATCHER_ERROR_EVENT, move |event| {
                errors
                    .lock()
                    .expect("記録のロックに失敗")
                    .push(serde_json::from_str(event.payload()).expect("断念を解釈できない"));
            });
        }

        let sink = TauriChangeSink::new(app.handle().clone());
        let change = FileChangeEvent {
            scope_id: "scope-3".to_owned(),
            change: crate::ipc::types::FileChange::FileModified {
                path: "a.md".to_owned(),
            },
        };
        sink.file_change(change.clone());
        sink.watcher_error("scope-3", ErrorCode::WatcherStopped);

        assert_eq!(*changes.lock().expect("記録のロックに失敗"), vec![change]);
        // 送出の時点で `AppState` が持つ言語（ここでは英語）で組み立てる。
        assert_eq!(
            *errors.lock().expect("記録のロックに失敗"),
            vec![watcher_error_event(
                "scope-3",
                ErrorCode::WatcherStopped,
                Language::En
            )]
        );
    }

    /// UI言語を切り替えると、以後の送出がその言語に従う（10.5）。
    #[test]
    fn the_tauri_sink_follows_a_language_change() {
        let app = tauri::test::mock_app();
        app.manage(AppState::new(crate::i18n::LanguagePreference::Ja));
        let errors: Arc<Mutex<Vec<WatcherErrorEvent>>> = Arc::new(Mutex::new(Vec::new()));
        {
            let errors = errors.clone();
            app.listen(WATCHER_ERROR_EVENT, move |event| {
                errors
                    .lock()
                    .expect("記録のロックに失敗")
                    .push(serde_json::from_str(event.payload()).expect("断念を解釈できない"));
            });
        }
        let sink = TauriChangeSink::new(app.handle().clone());

        sink.watcher_error("scope-4", ErrorCode::WatcherOverflow);
        app.state::<AppState>().set_language(Language::En);
        sink.watcher_error("scope-4", ErrorCode::WatcherOverflow);

        let recorded = errors.lock().expect("記録のロックに失敗").clone();
        assert_eq!(recorded.len(), 2);
        assert_eq!(
            recorded[0].error.message,
            message(ErrorCode::WatcherOverflow, Language::Ja)
        );
        assert_eq!(
            recorded[1].error.message,
            message(ErrorCode::WatcherOverflow, Language::En)
        );
    }
}
