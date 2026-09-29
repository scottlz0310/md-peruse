//! ファイルを文書として開き、タブで開くようFrontendへ知らせる（design-decisions.md 9.1、10.4）。
//!
//! ドロップされたファイルの入口である。開く場所はRust側が決める。開いているワークスペースの
//! 中にあれば通常タブ、外にあればloose tab（所在フォルダーを暗黙のルートとするスコープ）で
//! 開く。ドロップされたパスはFrontendへ渡さない（7.1）ため、Frontendへ知らせるのは
//! スコープIDとスコープ相対パスだけである。

use std::io;
use std::path::Path;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::ipc::error::ErrorCode;
use crate::ipc::types::OpenDocumentEvent;
use crate::open_folder::lock_lifecycle;
use crate::state::AppState;
use crate::watch_runtime::{ChangeSink, TauriChangeSink};

/// 文書をタブで開く指示を運ぶTauri eventの名前。
pub const OPEN_DOCUMENT_EVENT: &str = "open-document";

/// ファイルを文書として開き、Frontendへ知らせる。
///
/// 開閉を直列にするロックの内側で行う。ワークスペースの判定から送出までの間に切り替えが
/// 入ると、旧ワークスペースのスコープIDで開く指示が届き、Frontendはそれを捨てるため、
/// 開いたつもりの文書が開かない。
///
/// 読込の失敗はここでは扱わない。タブを開いた後の最初の読込に失敗したタブは、Frontendが
/// 閉じて理由を示す（9.1）。ここで返すのは、loose tabのスコープを作れなかった理由である。
pub fn open_document<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), ErrorCode> {
    let _lifecycle = lock_lifecycle();
    let state = app.state::<AppState>();
    let event = match state.workspace_document(path) {
        Some((scope_id, path)) => OpenDocumentEvent {
            scope_id,
            path,
            label: None,
        },
        None => {
            let sink: Arc<dyn ChangeSink> = Arc::new(TauriChangeSink::new(app.clone()));
            let opened = state
                .open_loose(path, sink)
                .map_err(|error| open_error_code(&error))?;
            OpenDocumentEvent {
                scope_id: opened.scope_id,
                path: opened.file,
                label: Some(opened.label),
            }
        }
    };
    // 送出の失敗は受け手（WebView）がいないときであり、伝える相手がいない。
    let _ = app.emit(OPEN_DOCUMENT_EVENT, event);
    Ok(())
}

/// 開けなかった理由を `ErrorCode` へ写す。
///
/// 見つからないことだけを分ける。ドロップから開くまでの間に移動・削除された場合であり、
/// 利用者はドロップし直せば済む。それ以外（アクセス拒否、扱えない名前、監視を開始できない）は
/// アクセスできないものとして示す。
fn open_error_code(error: &io::Error) -> ErrorCode {
    match error.kind() {
        io::ErrorKind::NotFound => ErrorCode::FileNotFound,
        _ => ErrorCode::FileAccessDenied,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::LanguagePreference;
    use std::fs;
    use std::sync::Mutex;
    use tauri::Listener;

    /// 状態を登録した `mock_app`。
    fn app() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(AppState::new(LanguagePreference::System));
        app
    }

    /// 開く指示を、届いた順に集める。
    fn collect(app: &tauri::App<tauri::test::MockRuntime>) -> Arc<Mutex<Vec<OpenDocumentEvent>>> {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&received);
        app.listen(OPEN_DOCUMENT_EVENT, move |event| {
            sink.lock()
                .expect("記録のロックに失敗")
                .push(serde_json::from_str(event.payload()).expect("指示を解釈できない"));
        });
        received
    }

    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "md-peruse-open-document-{name}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("一時フォルダーを作成できない");
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct DiscardingSink;

    impl ChangeSink for DiscardingSink {
        fn file_change(&self, _event: crate::ipc::types::FileChangeEvent) {}
        fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
        fn images_changed(&self, _scope_id: &str) {}
    }

    /// ワークスペースの中のファイルは、ワークスペースのスコープで、相対パスで知らせる。
    /// 外のファイルは、loose tabのスコープで、所在フォルダーの表示名を添える。どちらも
    /// 絶対パスをpayloadへ載せない（7.1）。
    #[test]
    fn a_document_is_opened_where_it_belongs() {
        let temp = TempDir::new("place");
        let workspace = temp.0.join("ws");
        fs::create_dir_all(workspace.join("docs")).unwrap();
        fs::write(workspace.join("docs/a.md"), b"# a\n").unwrap();
        fs::create_dir_all(temp.0.join("elsewhere")).unwrap();
        fs::write(temp.0.join("elsewhere/b.md"), b"# b\n").unwrap();
        let app = app();
        let events = collect(&app);
        app.state::<AppState>()
            .open_workspace(&workspace, Arc::new(DiscardingSink))
            .unwrap();
        let workspace_scope = app.state::<AppState>().scope_id().unwrap();

        open_document(app.handle(), &workspace.join("docs/a.md")).unwrap();
        open_document(app.handle(), &temp.0.join("elsewhere/b.md")).unwrap();

        let events = events.lock().unwrap().clone();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].scope_id, workspace_scope);
        assert_eq!(events[0].path, "docs/a.md");
        assert_eq!(events[0].label, None);
        assert_ne!(events[1].scope_id, workspace_scope);
        assert_eq!(events[1].path, "b.md");
        assert!(
            events[1]
                .label
                .as_deref()
                .is_some_and(|label| label.ends_with("elsewhere"))
        );
        // 絶対パスも、そのドライブ名も載せない。
        let payload = serde_json::to_string(&events).unwrap();
        assert!(!payload.contains(":\\\\"), "{payload}");
        assert!(!payload.contains("Users"), "{payload}");
    }

    /// ワークスペースを開いていなくても、単一のファイルをloose tabで開ける（9.2）。
    #[test]
    fn a_document_opens_without_a_workspace() {
        let temp = TempDir::new("no-workspace");
        fs::write(temp.0.join("a.md"), b"# a\n").unwrap();
        let app = app();
        let events = collect(&app);

        open_document(app.handle(), &temp.0.join("a.md")).unwrap();

        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].path, "a.md");
        assert!(events[0].label.is_some());
    }

    /// 同じファイルを続けて開くと、同じスコープで知らせる。同一文書を重複して開かない（9.1）。
    #[test]
    fn opening_the_same_document_again_reuses_the_scope() {
        let temp = TempDir::new("again");
        fs::write(temp.0.join("a.md"), b"# a\n").unwrap();
        let app = app();
        let events = collect(&app);

        open_document(app.handle(), &temp.0.join("a.md")).unwrap();
        open_document(app.handle(), &temp.0.join("a.md")).unwrap();

        let events = events.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].scope_id, events[1].scope_id);
    }

    /// 開けないファイルは、理由を返して何も知らせない。見つからないことは分ける。
    #[test]
    fn a_document_that_cannot_be_opened_is_reported_without_notifying() {
        let temp = TempDir::new("missing");
        fs::create_dir_all(temp.0.join("folder.md")).unwrap();
        let app = app();
        let events = collect(&app);

        assert_eq!(
            open_document(app.handle(), &temp.0.join("missing.md")),
            Err(ErrorCode::FileNotFound)
        );
        // フォルダーは文書として開けない。
        assert_eq!(
            open_document(app.handle(), &temp.0.join("folder.md")),
            Err(ErrorCode::FileAccessDenied)
        );
        assert!(events.lock().unwrap().is_empty());
    }
}
