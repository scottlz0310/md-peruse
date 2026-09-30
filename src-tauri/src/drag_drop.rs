//! ドラッグ＆ドロップの受け取りと実行（design-decisions.md 10.4）。
//!
//! ドロップされたパスはWebViewではなくRust側が受け取る。`tauri://drag-drop` はネイティブ
//! 絶対パスを運ぶため、Frontendでlistenすると「ネイティブ絶対パスをFrontendへ露出しない」
//! （7.1）を破る。Frontendへ渡すのは受け入れ可否（`DragState`）だけで、パスも座標も渡さない。
//! ドロップされたものを開くと、開き先は `workspace-opened` と `open-document`（スコープIDと
//! スコープ相対パス）で知らせる。
//!
//! 受け入れの規則は `crate::drop::plan_drop` を正本とする。ここに置くのは、ファイルシステムへの
//! 問い合わせ（種別の判定）と、規則の結果の実行である。

use std::fs;
use std::path::{Path, PathBuf};
use std::thread;

use tauri::{AppHandle, DragDropEvent, Emitter, Manager, Runtime, WebviewWindow, WindowEvent};

use crate::drop::{DropPlan, DroppedEntry, DroppedKind, plan_drop};
use crate::ipc::error::ErrorCode;
use crate::ipc::types::DragState;
use crate::open_document::open_documents;
use crate::open_folder::{open_path, show_error};

/// ドラッグの状態を運ぶTauri eventの名前。payloadは `DragState`。
pub const DRAG_STATE_EVENT: &str = "drag-state";

/// ウィンドウへのドラッグ＆ドロップの受け取りを登録する。
///
/// `tauri.conf.json` の `dragDropEnabled` が既定の有効のままである前提とする。無効にすると
/// HTML5のイベントがWebViewへ届くが、`File` からはフルパスを取れず、この機能の目的を満たさない
/// （10.4の実測）。
pub fn track<R: Runtime>(window: &WebviewWindow<R>) {
    let app = window.app_handle().clone();
    window.on_window_event(move |event| {
        if let WindowEvent::DragDrop(drag) = event {
            handle(&app, drag);
        }
    });
}

/// ドラッグの1つのイベントを処理する。
///
/// `over` は何もしない。マウス移動のたびに届き（実測。1回のドラッグで70件以上）、パスも
/// 持たないため、判定し直す理由がない。種別の問い合わせは `enter` で1回だけ行う。
fn handle<R: Runtime>(app: &AppHandle<R>, event: &DragDropEvent) {
    match event {
        DragDropEvent::Enter { paths, .. } => {
            let state = if plan_of(paths).is_empty() {
                DragState::Rejected
            } else {
                DragState::Acceptable
            };
            announce(app, state);
        }
        DragDropEvent::Over { .. } => {}
        DragDropEvent::Leave => announce(app, DragState::Idle),
        DragDropEvent::Drop { paths, .. } => {
            announce(app, DragState::Idle);
            let app = app.clone();
            let paths = paths.clone();
            // フォルダーを開くとファイルシステムへ触れる。応答の遅いストレージで、ウィンドウの
            // イベントを処理するスレッドを止めないよう、別のスレッドで行う。
            thread::spawn(move || execute(&app, &paths));
        }
        // 種類が増えても、知らない種類は何もしない。
        _ => {}
    }
}

fn announce<R: Runtime>(app: &AppHandle<R>, state: DragState) {
    // 送出の失敗は受け手（WebView）がいないときであり、伝える相手がいない。
    let _ = app.emit(DRAG_STATE_EVENT, state);
}

/// ドロップされたパスから、行う処理を決める。
///
/// 種別はファイルシステムへ問い合わせる。`docs.md` という名前のフォルダーは、拡張子の
/// 判定では対象ファイルに見えるためである（10.4）。正規化は7.1の境界判定と同じ手順で
/// 済ませる。実在しないパスとアクセスできないパスは、受け入れる対象がないものとして落とす。
fn plan_of(paths: &[PathBuf]) -> DropPlan {
    let entries: Vec<DroppedEntry> = paths
        .iter()
        .filter_map(|path| {
            let canonical = fs::canonicalize(path).ok()?;
            let kind = if canonical.is_dir() {
                DroppedKind::Directory
            } else {
                DroppedKind::File
            };
            Some(DroppedEntry {
                path: canonical.to_str()?.to_owned(),
                kind,
            })
        })
        .collect();
    plan_drop(&entries)
}

/// ドロップされたものを開く。
///
/// フォルダーを先に開いてから、ファイルを開く。逆にすると、ワークスペースの切り替えが同じ
/// ドロップで開いたファイルのタブを破棄する（10.4）。開けなかったものの理由は、1つの
/// ダイアログへまとめて示す。フォルダーが開けなくても、ファイルは開く。
fn execute<R: Runtime>(app: &AppHandle<R>, paths: &[PathBuf]) {
    let plan = plan_of(paths);
    let mut failures: Vec<ErrorCode> = Vec::new();
    let mut fail = |code: ErrorCode| {
        if !failures.contains(&code) {
            failures.push(code);
        }
    };
    if let Some(folder) = &plan.workspace {
        if let Err(code) = open_path(app, Path::new(folder)) {
            fail(code);
        }
    }
    for code in open_documents(app, &plan.files) {
        fail(code);
    }
    if !failures.is_empty() {
        show_error(app, &failures);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::LanguagePreference;
    use crate::ipc::types::OpenDocumentEvent;
    use crate::open_document::OPEN_DOCUMENT_EVENT;
    use crate::state::AppState;
    use std::sync::{Arc, Mutex};
    use tauri::{Listener, Manager};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("md-peruse-drag-drop-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("一時フォルダーを作成できない");
            Self(path)
        }

        fn write(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"# doc\n").unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// 開ける対象を含むドラッグは受け入れ、含まないドラッグは受け入れない。可否は実行と同じ
    /// 規則（`plan_drop`）で決める。「受け入れられる」と示しておいて何も起きない状態を作らない。
    #[test]
    fn acceptance_follows_what_the_drop_would_do() {
        let temp = TempDir::new("plan");
        let document = temp.write("a.md");
        let text = temp.write("note.txt");
        let folder = temp.0.join("sub");
        fs::create_dir_all(&folder).unwrap();
        // `docs.md` という名前のフォルダーは、拡張子からはファイルに見える。
        let tricky = temp.0.join("docs.md");
        fs::create_dir_all(&tricky).unwrap();
        let missing = temp.0.join("missing.md");

        let cases: [(&str, Vec<PathBuf>, bool, usize); 6] = [
            ("Markdownのファイル", vec![document.clone()], false, 1),
            ("フォルダー", vec![folder.clone()], true, 0),
            ("対象外のファイルだけ", vec![text.clone()], false, 0),
            ("`.md` の名前のフォルダー", vec![tricky], true, 0),
            ("実在しないパス", vec![missing], false, 0),
            ("混在", vec![text, document, folder], true, 1),
        ];
        for (name, paths, has_workspace, file_count) in cases {
            let plan = plan_of(&paths);
            assert_eq!(plan.workspace.is_some(), has_workspace, "{name}");
            assert_eq!(plan.files.len(), file_count, "{name}");
        }
    }

    /// 状態を登録した `mock_app`。
    fn app() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(AppState::new(LanguagePreference::System));
        app
    }

    fn collect<T: serde::de::DeserializeOwned + Send + 'static>(
        app: &tauri::App<tauri::test::MockRuntime>,
        event: &'static str,
    ) -> Arc<Mutex<Vec<T>>> {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&received);
        app.listen(event, move |event| {
            sink.lock()
                .expect("記録のロックに失敗")
                .push(serde_json::from_str(event.payload()).expect("payloadを解釈できない"));
        });
        received
    }

    /// `enter` は受け入れ可否を知らせ、`over` は何もせず、`leave` は表示を戻す。可否の通知が
    /// 運ぶのは `DragState` だけで、パスを含まない（10.4、7.1）。
    #[test]
    fn the_drag_states_follow_the_events() {
        let temp = TempDir::new("states");
        let document = temp.write("a.md");
        let text = temp.write("note.txt");
        let app = app();
        let states: Arc<Mutex<Vec<DragState>>> = collect(&app, DRAG_STATE_EVENT);
        let position = tauri::PhysicalPosition::new(0.0, 0.0);

        handle(
            app.handle(),
            &DragDropEvent::Enter {
                paths: vec![document.clone()],
                position,
            },
        );
        handle(app.handle(), &DragDropEvent::Over { position });
        handle(app.handle(), &DragDropEvent::Leave);
        handle(
            app.handle(),
            &DragDropEvent::Enter {
                paths: vec![text],
                position,
            },
        );

        assert_eq!(
            *states.lock().unwrap(),
            vec![DragState::Acceptable, DragState::Idle, DragState::Rejected]
        );
    }

    /// ドロップは、フォルダーを開いてからファイルを開く。フォルダーが開けなくても、ファイルは開く。
    /// 開き先はスコープIDとスコープ相対パスで知らせ、絶対パスを載せない（10.4）。
    #[test]
    fn a_drop_opens_the_folder_before_its_files() {
        let temp = TempDir::new("execute");
        let workspace = temp.0.join("ws");
        let inside = temp.write("ws/docs/a.md");
        let app = app();
        // フォルダーを開くにはSettingsStoreと最近使ったフォルダーが要る。
        app.manage(crate::recent::RecentFolders::new());
        app.manage(crate::settings_store::SettingsStore::without_saving(
            crate::settings::Settings::default(),
        ));
        app.manage(crate::telemetry::Telemetry::new(
            Box::new(crate::telemetry::NullLogger),
            None,
        ));
        let documents: Arc<Mutex<Vec<OpenDocumentEvent>>> = collect(&app, OPEN_DOCUMENT_EVENT);

        execute(app.handle(), &[inside, workspace.clone()]);

        let documents = documents.lock().unwrap();
        assert_eq!(documents.len(), 1);
        // フォルダーが先に開いているため、ファイルはそのワークスペースの通常タブとして開く。
        assert_eq!(
            documents[0].scope_id,
            app.state::<AppState>().scope_id().expect("開いていない")
        );
        assert_eq!(documents[0].path, "docs/a.md");
        assert_eq!(documents[0].label, None);
    }
}
