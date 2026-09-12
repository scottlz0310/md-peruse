//! 「フォルダーを開く」の処理（design-decisions.md 6.1、10.1）。
//!
//! ネイティブメニューから選ばれると、Rust側でフォルダー選択ダイアログを開き、選ばれた
//! フォルダーをワークスペースとして開く。成功はeventでFrontendへ知らせ、失敗はネイティブ
//! ダイアログで示す。フォルダーの選択はWebViewを経由しないため、Frontendへファイル
//! システム系のcapabilityを渡さない（5.5）。
//!
//! ダイアログは `tauri-plugin-dialog` をRust側からだけ使う。JSのパッケージは入れず、
//! capabilityにもdialogの権限を加えない。

use std::io;
use std::path::Path;
use std::sync::Arc;

use tauri::menu::MenuEvent;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::ipc::error::ErrorCode;
use crate::ipc::message::message;
use crate::ipc::types::WorkspaceOpenedEvent;
use crate::menu::MenuCommand;
use crate::settings::recent_folder_label;
use crate::state::AppState;
use crate::watch_runtime::{ChangeSink, TauriChangeSink};

/// ワークスペースを開いたことを運ぶTauri eventの名前。
pub const WORKSPACE_OPENED_EVENT: &str = "workspace-opened";

/// ダイアログの親にするウィンドウのラベル（`tauri.conf.json` の `app.windows`）。
const MAIN_WINDOW: &str = "main";

/// メニューの選択を処理する。
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match MenuCommand::from_id(event.id().as_ref()) {
        Some(MenuCommand::OpenFolder) => pick_and_open(app),
        Some(MenuCommand::Exit) => app.exit(0),
        // 載せていないコマンドとアプリが作っていない項目は、選ばれることがない。
        _ => {}
    }
}

/// フォルダー選択ダイアログを開き、選ばれたフォルダーをワークスペースとして開く。
///
/// ダイアログは非同期のAPIを使う。メニューの処理はメインスレッドで呼ばれ、同期のAPIで
/// 待つとダイアログのメッセージループと競合する。
fn pick_and_open<R: Runtime>(app: &AppHandle<R>) {
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
        let state = app.state::<AppState>();
        let sink: Arc<dyn ChangeSink> = Arc::new(TauriChangeSink::new(app.clone()));
        match open_selected_folder(&state, &path, sink) {
            // 送出の失敗は受け手（WebView）がいないときであり、伝える相手がいない。
            Ok(opened) => {
                let _ = app.emit(WORKSPACE_OPENED_EVENT, opened);
            }
            Err(code) => show_error(&app, code),
        }
    });
}

/// 選ばれたフォルダーをワークスペースとして開き、Frontendへ送る通知を作る。
///
/// 開けなかった場合は現在のワークスペースを保つ（`AppState::open_workspace`）。
pub fn open_selected_folder(
    state: &AppState,
    path: &Path,
    sink: Arc<dyn ChangeSink>,
) -> Result<WorkspaceOpenedEvent, ErrorCode> {
    state
        .open_workspace(path, sink)
        .map_err(|error| open_error_code(&error))?;
    let scope_id = state
        .scope_id()
        .expect("開いた直後のワークスペースはスコープを持つ");
    Ok(WorkspaceOpenedEvent {
        scope_id,
        label: recent_folder_label(&path.to_string_lossy()),
    })
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

/// 開けなかった理由をネイティブダイアログで示す（12章）。
///
/// Frontendではなくネイティブダイアログにするのは、失敗したのがWebViewの外で始まった
/// 操作（メニューとダイアログ）だからである。文言は表示時点のUI言語で組み立てる（10.5）。
fn show_error<R: Runtime>(app: &AppHandle<R>, code: ErrorCode) {
    let language = app.state::<AppState>().language();
    let mut dialog = app
        .dialog()
        .message(message(code, language))
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
    use std::fs;
    use std::path::PathBuf;

    struct DiscardingSink;

    impl ChangeSink for DiscardingSink {
        fn file_change(&self, _event: FileChangeEvent) {}
        fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
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
