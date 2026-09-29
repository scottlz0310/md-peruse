//! Frontendから呼ぶTauri command（design-decisions.md 5.3）。
//!
//! Frontendから受け取ったパスはここで再検証する。汎用のファイルシステムAPIは公開せず、
//! 走査、読込、画像resource IDの発行、設定の取得と保存に必要なcommandだけを置く。
//!
//! commandの戻り値の失敗は `IpcError` とし、Frontendは `code` で分岐する。表示場所
//! （ネイティブダイアログ、プレビュー領域、ツリー項目、文書内要素）はFrontendが呼び出しの
//! 文脈から決めるため、応答へ含めない。
//!
//! ファイルシステムへ触れるcommandは `async fn` とし、同期I/Oを
//! `async_runtime::spawn_blocking` へ渡す。Tauriは `async` を付けないcommandをメインスレッド
//! で実行するため、同期のままではネットワークドライブや応答の遅いストレージでウィンドウの
//! 操作が止まる。上限（10 MiB）はバイト数を縛るだけで待ち時間を縛らない（5.3）。

use std::io;

use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Manager, State};

use crate::i18n::Language;
use crate::image::issue::issue;
use crate::ipc::error::{ErrorCode, IpcError};
use crate::ipc::message::ipc_error;
use crate::ipc::types::{
    FileContent, ImageResource, ImageResourceRequest, LooseWatchRequest, ReadRequest, ScanRequest,
    ScanResult, WorkspaceOpenedEvent,
};
use crate::open_folder;
use crate::path_guard::{PathRejection, ResolveError};
use crate::read::{ReadError, is_sharing_violation, read_file};
use crate::recent::{self, RecentFolders};
use crate::scan::scan_directory;
use crate::settings::{UiSettings, UiSettingsUpdate};
use crate::settings_store::SettingsStore;
use crate::state::AppState;

/// ディレクトリ1階層を走査する。
///
/// ルート直下は `path` に空文字を渡す。サブフォルダーは展開時にその都度呼ぶ（6.2）。
///
/// 応答の陳腐化はFrontendが持つワークスペース世代とパス世代で判定する。要求へ世代を
/// 載せないのは、`await invoke()` が要求と応答を対応付けるためである（5.3）。
///
/// 走査は `hasChildren` の判定でサブディレクトリを実際に読むため、1階層でも件数に応じた
/// I/Oを伴う（6.2）。読込と同じくブロッキングスレッドで実行する。
#[tauri::command]
pub async fn scan_directory_command(
    state: State<'_, AppState>,
    request: ScanRequest,
) -> Result<ScanResult, IpcError> {
    let language = state.language();
    let workspace = state.workspace();
    let requested_path = request.path.clone();
    let result = spawn_blocking(move || workspace.with(|root| scan_directory(root, &request.path)))
        .await
        .expect("走査タスクの実行に失敗");
    // ワークスペースを開いていない状態で走査を求められた場合。Frontendはwelcome状態で
    // ツリーを出さないため通常は起きないが、開いていないことをルートの不在として返す。
    let Some(result) = result else {
        return Err(ipc_error(ErrorCode::WorkspaceNotFound, language, None));
    };
    result.map_err(|error| scan_error(&error, &requested_path, language))
}

/// 走査の失敗を `IpcError` へ写す。
///
/// `detail` へ載せるのは、形式の検証を通った要求パスだけとする。検証に落ちた入力は
/// ワークスペース相対パスであるとは限らず、ネイティブ絶対パス、UNC表記、device pathが
/// そのまま渡されている場合がある。それを応答へ載せると、`message` と `detail` へ
/// ネイティブ絶対パスを含めないという契約（design-decisions.md 5.3、7.1）を破る。
///
/// 境界外（`PathOutsideWorkspace`）と、見つからない・アクセスできない場合は、形式の検証を
/// 通っているためワークスペース相対パスである。どの項目で失敗したかを示すために載せる。
fn scan_error(error: &ResolveError, requested_path: &str, language: Language) -> IpcError {
    let detail = match error {
        ResolveError::Rejected(PathRejection::Malformed) => None,
        _ => Some(requested_path.to_owned()),
    };
    ipc_error(directory_error_code(error), language, detail)
}

/// ディレクトリ走査の失敗を `ErrorCode` へ写す。
///
/// ファイル読込の失敗と分けるのは、走査の失敗をツリー全体の失敗とせず該当項目へ表示する
/// ためである（6.2）。原因が同じ「アクセス拒否」でも、対象も表示先も異なる（5.3）。
fn directory_error_code(error: &ResolveError) -> ErrorCode {
    match error {
        ResolveError::Rejected(PathRejection::Malformed) => ErrorCode::PathRejected,
        ResolveError::Rejected(PathRejection::Outside) => ErrorCode::PathOutsideWorkspace,
        // `NotFound` 以外はすべてアクセスできないものとして扱う。デバイスの切断や
        // ネットワークドライブの切断もここへ入る。利用者にとって「開けない」ことは
        // 同じであり、原因の内訳は診断（11.2）の関心である。
        ResolveError::Io(error) if error.kind() == io::ErrorKind::NotFound => {
            ErrorCode::DirectoryNotFound
        }
        ResolveError::Io(_) => ErrorCode::DirectoryAccessDenied,
    }
}

/// ファイルを1件読み込む。
///
/// 対象は常にワークスペース相対パスであり、境界の検証は `read_file` が行う（7.1）。
/// 応答が持つのは要求と同じ相対パスであり、ネイティブ絶対パスを含めない。
///
/// 同じタブに対する複数の読込の競合は、Frontendが持つタブごとの読込世代で判定する
/// （design-decisions.md 6.5）。要求と応答の対応付けは `await invoke()` が行うため、
/// 要求へ世代を載せない（5.3）。
///
/// パスの解決からデコードまでをブロッキングスレッドで実行する。10 MiBの上限はバイト数を
/// 縛るだけで待ち時間を縛らず、応答の遅いストレージではI/Oが戻るまで時間がかかるためである。
#[tauri::command]
pub async fn read_file_command(
    state: State<'_, AppState>,
    request: ReadRequest,
) -> Result<FileContent, IpcError> {
    let language = state.language();
    let workspace = state.workspace();
    let requested_path = request.path.clone();
    let result = spawn_blocking(move || {
        workspace.with_scope(&request.scope_id, |root| read_file(root, &request.path))
    })
    .await
    .expect("読込タスクの実行に失敗");
    // 開いていないスコープを求められた場合。閉じたloose tabや、切り替え前のワークスペースの
    // スコープIDで届いた要求である。スコープが閉じていることを、ルートの不在として返す。
    let Some(result) = result else {
        return Err(ipc_error(ErrorCode::WorkspaceNotFound, language, None));
    };
    result.map_err(|error| read_error(&error, &requested_path, language))
}

/// 読込の失敗を `IpcError` へ写す。
///
/// `detail` の扱いは走査（`scan_error`）と同じである。形式の検証に落ちた入力はワークスペース
/// 相対パスであるとは限らず、応答へ載せるとネイティブ絶対パスを含めないという契約
/// （design-decisions.md 5.3、7.1）を破る。
fn read_error(error: &ReadError, requested_path: &str, language: Language) -> IpcError {
    let detail = match error {
        ReadError::Resolve(ResolveError::Rejected(PathRejection::Malformed)) => None,
        _ => Some(requested_path.to_owned()),
    };
    ipc_error(file_error_code(error), language, detail)
}

/// ファイル読込の失敗を `ErrorCode` へ写す。
///
/// ディレクトリ走査と分けるのは、読込の失敗がタブの表示に影響する一方、走査の失敗は
/// ツリー項目へ表示するためである。原因が同じ「アクセス拒否」でも扱いが異なる（5.3）。
fn file_error_code(error: &ReadError) -> ErrorCode {
    match error {
        ReadError::TooLarge => ErrorCode::FileTooLarge,
        ReadError::Decode => ErrorCode::DecodeFailed,
        ReadError::Resolve(ResolveError::Rejected(PathRejection::Malformed)) => {
            ErrorCode::PathRejected
        }
        ReadError::Resolve(ResolveError::Rejected(PathRejection::Outside)) => {
            ErrorCode::PathOutsideWorkspace
        }
        ReadError::Resolve(ResolveError::Io(cause)) if cause.kind() == io::ErrorKind::NotFound => {
            ErrorCode::FileNotFound
        }
        // 共有違反は、対象を使っている側が閉じれば解消しうる点でアクセス拒否と異なる。
        // 利用者が再実行できるよう別の `code` で示す。自動での再試行は行わない（12章）。
        ReadError::Resolve(ResolveError::Io(cause)) if is_sharing_violation(cause) => {
            ErrorCode::FileLocked
        }
        ReadError::Resolve(ResolveError::Io(_)) => ErrorCode::FileAccessDenied,
    }
}

/// 文書が参照する画像に、まとめてresource IDを発行する（design-decisions.md 5.4）。
///
/// 応答は要求の `references` と同じ順に、要素ごとの成功と失敗を持つ。一部の画像が発行
/// できなくても他の画像は表示するためである（7.3）。commandそのものが失敗するのは
/// ワークスペースを開いていないときだけである。
///
/// 発行はファイルのヘッダーだけを読むが、1文書の画像数に比例したI/Oを伴うため、走査・読込と
/// 同じくブロッキングスレッドで実行する（5.3）。
#[tauri::command]
pub async fn issue_image_resources_command(
    state: State<'_, AppState>,
    request: ImageResourceRequest,
) -> Result<Vec<ImageResource>, IpcError> {
    let language = state.language();
    let workspace = state.workspace();
    let result = spawn_blocking(move || {
        workspace.with_scope_images(&request.scope_id, |root, images| {
            request
                .references
                .into_iter()
                .map(
                    |reference| match issue(root, images, &request.document_path, &reference) {
                        Ok(resource_id) => ImageResource::Issued {
                            reference,
                            resource_id,
                        },
                        Err(error) => ImageResource::Failed {
                            reference,
                            // `detail` は載せない。応答の要素は要求の参照文字列を持っており、
                            // Frontendはどの画像の失敗かをそこから知る。解決した相対パスを別に
                            // 返すと、Frontendがパスの規則を知る必要が生じる。
                            error: ipc_error(error.code(), language, None),
                        },
                    },
                )
                .collect()
        })
    })
    .await
    .expect("画像resource IDの発行タスクの実行に失敗");
    result.ok_or_else(|| ipc_error(ErrorCode::WorkspaceNotFound, language, None))
}

/// loose tabの監視先を、タブが表示している文書へ付け替える（design-decisions.md 6.4）。
///
/// 相対リンクで同じ暗黙のルートの別の文書へ移ると、タブの文書が替わる。監視は開いているファイル
/// 1件に限るため、Frontendが読込の応答を採用したときに、この文書へ付け替えさせる。読込
/// （`read_file_command`）は付け替えない。読んだ応答をFrontendが世代の判定で捨てることがあり、その
/// 文書へ監視が移ると、表示中の文書の更新を検知できなくなるためである。
///
/// 付け替えに失敗したときは、そのスコープへ `watcherStopped` を通知する（event）。ワークスペースと、
/// 開いていないスコープには何もしない。監視の停止は監視スレッドの終了まで待つため、
/// ブロッキングスレッドで実行する。
///
/// 失敗しない操作だが、借用（`State`）を受ける `async` のcommandは `Result` を返す決まりであり、
/// Tauriのマクロが要求する。
#[tauri::command]
pub async fn watch_loose_document_command(
    state: State<'_, AppState>,
    request: LooseWatchRequest,
) -> Result<(), IpcError> {
    let workspace = state.workspace();
    spawn_blocking(move || {
        workspace.retarget_loose(
            &request.scope_id,
            &request.path,
            &request.tab_id,
            request.generation,
        );
    })
    .await
    .expect("loose tabの監視の付け替えタスクの実行に失敗");
    Ok(())
}

/// loose tabのスコープを閉じ、そのファイルの監視を止める（design-decisions.md 6.4、9.1）。
///
/// タブを閉じたときと、上限（9.1）で退避されたときに、Frontendが求める。開いていない
/// スコープ（ワークスペースを切り替えて破棄済みのものを含む）には何もしない。ワークスペースの
/// スコープIDを渡されても閉じない。閉じる操作は「ワークスペースを閉じる」（10.1）だけである。
///
/// 監視の停止は監視スレッドの終了まで待つため、ブロッキングスレッドで実行する。
///
/// 失敗しない操作だが、借用（`State`）を受ける `async` のcommandは `Result` を返す決まりであり、
/// Tauriのマクロが要求する。
#[tauri::command]
pub async fn close_loose_scope_command(
    state: State<'_, AppState>,
    scope_id: String,
) -> Result<(), IpcError> {
    let workspace = state.workspace();
    spawn_blocking(move || workspace.close_loose(&scope_id))
        .await
        .expect("loose tabのスコープを閉じるタスクの実行に失敗");
    Ok(())
}

/// 起動時の設定をFrontendへ渡す（design-decisions.md 11.1）。
///
/// 絶対パスを含まない投影（`UiSettings`）だけを返す。ファイルは起動時に読み終えており、
/// ここではI/Oを伴わないため同期のcommandとする。
#[tauri::command]
pub fn get_ui_settings_command(
    state: State<'_, AppState>,
    settings: State<'_, SettingsStore>,
    recents: State<'_, RecentFolders>,
) -> UiSettings {
    settings.ui_settings(state.language(), recents.views())
}

/// 開いているワークスペースを返す。開いていなければ `None` を返す（9.2、11.1）。
///
/// 起動時に、Rustが最後のワークスペースを開き直す。その `workspace-opened` がWebViewの購読より
/// 先に送られると、Frontendは開いていることを知れない。Frontendは購読してからこのcommandで
/// 問い合わせ、購読後の変化はeventで受ける。WebViewを読み込み直したときも、Rust側に残る
/// ワークスペースを取り戻せる。
///
/// 開閉と同じロックを待つため、応答の遅いストレージを開いている最中はここも待つ。
/// ブロッキングスレッドで実行する。
#[tauri::command]
pub async fn get_workspace_command(app: AppHandle) -> Option<WorkspaceOpenedEvent> {
    spawn_blocking(move || open_folder::current_workspace(&app))
        .await
        .expect("ワークスペースの問い合わせタスクの実行に失敗")
}

/// 最近使ったフォルダーの項目をワークスペースとして開く（9.2、11.1）。
///
/// 成功は `workspace-opened` で知らせる（フォルダー選択と同じ経路）。IDは一覧を作り直すたびに
/// 振り直すため、未知のIDは `RecentFolderNotFound` で拒否する。フォルダー自体が見つからない
/// ときは `WorkspaceNotFound` とし、その項目を一覧から取り除く（`crate::recent::open`）。
///
/// フォルダーを開くときのI/Oを伴うため、ブロッキングスレッドで実行する。
#[tauri::command]
pub async fn open_recent_folder_command(app: AppHandle, id: String) -> Result<(), IpcError> {
    let language = app.state::<AppState>().language();
    spawn_blocking(move || recent::open(&app, &id))
        .await
        .expect("最近使ったフォルダーを開くタスクの実行に失敗")
        .map_err(|code| ipc_error(code, language, None))
}

/// Frontendで変わった設定を保存する（design-decisions.md 11.1）。
///
/// 書込みはdebounceして別スレッドで行うため、この呼び出しは書込みを待たない。書込みの
/// 失敗は `ErrorCode::SettingsSaveFailed` としてネイティブダイアログで示す。
#[tauri::command]
pub fn update_ui_settings_command(settings: State<'_, SettingsStore>, update: UiSettingsUpdate) {
    settings.update(update);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_errors_map_to_directory_codes() {
        let cases = [
            (
                ResolveError::Rejected(PathRejection::Malformed),
                ErrorCode::PathRejected,
            ),
            (
                ResolveError::Rejected(PathRejection::Outside),
                ErrorCode::PathOutsideWorkspace,
            ),
            (
                ResolveError::Io(io::Error::from(io::ErrorKind::NotFound)),
                ErrorCode::DirectoryNotFound,
            ),
            (
                ResolveError::Io(io::Error::from(io::ErrorKind::PermissionDenied)),
                ErrorCode::DirectoryAccessDenied,
            ),
            // ファイル読込の `FileNotFound` や `FileAccessDenied` へは倒さない。
            (
                ResolveError::Io(io::Error::from(io::ErrorKind::NotConnected)),
                ErrorCode::DirectoryAccessDenied,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(directory_error_code(&error), expected, "{error:?}");
        }
    }

    #[test]
    fn rejected_requests_do_not_echo_the_input_path() {
        // Frontendから届いた文字列が相対パスとは限らない。形式の検証に落ちた入力は
        // 応答へ載せない（design-decisions.md 5.3、7.1）。
        let native_paths = [
            r"C:\Users\someone\secret",
            r"\\server\share\secret.md",
            r"\\?\C:\Users\someone\secret.md",
            "a.md:stream",
        ];
        for path in native_paths {
            let error = scan_error(
                &ResolveError::Rejected(PathRejection::Malformed),
                path,
                Language::Ja,
            );
            assert_eq!(error.code, ErrorCode::PathRejected);
            assert_eq!(error.detail, None, "入力をそのまま返している: {path}");
            assert!(
                !error.message.contains(path),
                "文言が入力を含む: {}",
                error.message
            );
        }
    }

    #[test]
    fn resolvable_requests_carry_the_relative_path() {
        // 形式の検証を通った要求は、どの項目で失敗したかを示すために `detail` へ載せる。
        let cases = [
            (
                ResolveError::Rejected(PathRejection::Outside),
                ErrorCode::PathOutsideWorkspace,
            ),
            (
                ResolveError::Io(io::Error::from(io::ErrorKind::NotFound)),
                ErrorCode::DirectoryNotFound,
            ),
            (
                ResolveError::Io(io::Error::from(io::ErrorKind::PermissionDenied)),
                ErrorCode::DirectoryAccessDenied,
            ),
        ];
        for (error, expected_code) in cases {
            let ipc = scan_error(&error, "docs/sub", Language::Ja);
            assert_eq!(ipc.code, expected_code);
            assert_eq!(ipc.detail.as_deref(), Some("docs/sub"));
        }
    }

    #[test]
    fn file_errors_map_to_file_codes() {
        // `ERROR_SHARING_VIOLATION`。`io::ErrorKind` では区別できないためOSのコードで作る。
        let sharing_violation = io::Error::from_raw_os_error(32);
        let cases = [
            (ReadError::TooLarge, ErrorCode::FileTooLarge),
            (ReadError::Decode, ErrorCode::DecodeFailed),
            (
                ReadError::Resolve(ResolveError::Rejected(PathRejection::Malformed)),
                ErrorCode::PathRejected,
            ),
            (
                ReadError::Resolve(ResolveError::Rejected(PathRejection::Outside)),
                ErrorCode::PathOutsideWorkspace,
            ),
            (
                ReadError::Resolve(ResolveError::Io(io::Error::from(io::ErrorKind::NotFound))),
                ErrorCode::FileNotFound,
            ),
            (
                ReadError::Resolve(ResolveError::Io(sharing_violation)),
                ErrorCode::FileLocked,
            ),
            (
                ReadError::Resolve(ResolveError::Io(io::Error::from(
                    io::ErrorKind::PermissionDenied,
                ))),
                ErrorCode::FileAccessDenied,
            ),
            // ディレクトリ側の `code` へは倒さない。対象も表示先も異なる（5.3）。
            (
                ReadError::Resolve(ResolveError::Io(io::Error::from(
                    io::ErrorKind::NotConnected,
                ))),
                ErrorCode::FileAccessDenied,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(file_error_code(&error), expected, "{error:?}");
        }
    }

    #[test]
    fn rejected_reads_do_not_echo_the_input_path() {
        // 走査と同じく、形式の検証に落ちた入力は応答へ載せない（5.3、7.1）。
        let native_paths = [
            r"C:\Users\someone\secret.md",
            r"\\server\share\secret.md",
            r"\\?\C:\Users\someone\secret.md",
            "a.md:stream",
        ];
        for path in native_paths {
            let error = read_error(
                &ReadError::Resolve(ResolveError::Rejected(PathRejection::Malformed)),
                path,
                Language::Ja,
            );
            assert_eq!(error.code, ErrorCode::PathRejected);
            assert_eq!(error.detail, None, "入力をそのまま返している: {path}");
            assert!(
                !error.message.contains(path),
                "文言が入力を含む: {}",
                error.message
            );
        }
    }

    #[test]
    fn failed_reads_carry_the_relative_path() {
        // 形式の検証を通った要求は、どのファイルで失敗したかを示すために `detail` へ載せる。
        let cases = [
            (ReadError::TooLarge, ErrorCode::FileTooLarge),
            (ReadError::Decode, ErrorCode::DecodeFailed),
            (
                ReadError::Resolve(ResolveError::Io(io::Error::from(io::ErrorKind::NotFound))),
                ErrorCode::FileNotFound,
            ),
        ];
        for (error, expected_code) in cases {
            let ipc = read_error(&error, "docs/note.md", Language::Ja);
            assert_eq!(ipc.code, expected_code);
            assert_eq!(ipc.detail.as_deref(), Some("docs/note.md"));
        }
    }

    /// command本体を `tauri::test::mock_app` の managed state 経由で呼ぶ。
    ///
    /// 上のテストはエラーの写像だけを見ており、引数の組み立て、`spawn_blocking` への受け渡し、
    /// ワークスペース未オープンの分岐は通らない。`State<'_, AppState>` はruntimeに依存しない
    /// 型のため、mock appの managed state からそのまま取れる（design-decisions.md 14.2）。
    mod command_bodies {
        use super::*;
        use crate::i18n::LanguagePreference;
        use crate::watch_runtime::ChangeSink;
        use std::sync::Arc;
        use tauri::Manager;
        use tauri::async_runtime::block_on;

        /// 送出を捨てる `ChangeSink`。ここで見るのはcommandの応答である。
        struct DiscardingSink;

        impl ChangeSink for DiscardingSink {
            fn file_change(&self, _event: crate::ipc::types::FileChangeEvent) {}
            fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
            fn images_changed(&self, _scope_id: &str) {}
        }

        /// テスト用の一時フォルダー。終了時に削除する。
        struct TempDir(std::path::PathBuf);

        impl TempDir {
            fn new(name: &str) -> Self {
                let path = std::env::temp_dir()
                    .join(format!("md-peruse-command-{name}-{}", std::process::id()));
                let _ = std::fs::remove_dir_all(&path);
                std::fs::create_dir_all(&path).expect("一時フォルダーを作成できない");
                Self(path)
            }

            fn path(&self) -> &std::path::Path {
                &self.0
            }
        }

        impl Drop for TempDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        fn mock_app_with_state(
            language: LanguagePreference,
        ) -> tauri::App<tauri::test::MockRuntime> {
            let app = tauri::test::mock_app();
            app.manage(AppState::new(language));
            app
        }

        /// ワークスペースを開いていれば、走査と読込が応答を返す。
        #[test]
        fn the_commands_answer_for_an_open_workspace() {
            let temp = TempDir::new("open");
            std::fs::write(temp.path().join("note.md"), b"# note\n").expect("書込みに失敗");
            std::fs::create_dir(temp.path().join("sub")).expect("フォルダーの作成に失敗");
            let app = mock_app_with_state(LanguagePreference::Ja);
            app.state::<AppState>()
                .open_workspace(temp.path(), Arc::new(DiscardingSink))
                .expect("ワークスペースを開けない");

            let scan = block_on(scan_directory_command(
                app.state::<AppState>(),
                ScanRequest {
                    path: String::new(),
                },
            ))
            .expect("走査が失敗した");
            let names: Vec<&str> = scan
                .entries
                .iter()
                .map(|entry| entry.name.as_str())
                .collect();
            // フォルダーが先、ファイルが後（6.2）。
            assert_eq!(names, vec!["sub", "note.md"]);

            let content = block_on(read_file_command(
                app.state::<AppState>(),
                ReadRequest {
                    scope_id: app.state::<AppState>().scope_id().expect("スコープがない"),
                    path: "note.md".to_owned(),
                },
            ))
            .expect("読込が失敗した");
            assert_eq!(content.text, "# note\n");
        }

        /// ワークスペースを開いていなければ、両commandとも `WorkspaceNotFound` を返す。
        ///
        /// ルートの不在は走査・読込それぞれの `ErrorCode` ではなくこのコードで表す。
        #[test]
        fn the_commands_report_a_missing_workspace() {
            let app = mock_app_with_state(LanguagePreference::Ja);

            let scan = block_on(scan_directory_command(
                app.state::<AppState>(),
                ScanRequest {
                    path: String::new(),
                },
            ))
            .expect_err("開いていないのに走査が成功した");
            assert_eq!(scan.code, ErrorCode::WorkspaceNotFound);

            let read = block_on(read_file_command(
                app.state::<AppState>(),
                ReadRequest {
                    scope_id: "scope".to_owned(),
                    path: "note.md".to_owned(),
                },
            ))
            .expect_err("開いていないのに読込が成功した");
            assert_eq!(read.code, ErrorCode::WorkspaceNotFound);
        }

        /// 形式の検証に落ちた要求の `detail` に、受け取った文字列を載せない。
        ///
        /// ネイティブ絶対パスがそのまま渡されている場合があり、載せると「応答へ絶対パスを
        /// 含めない」契約（5.3、7.1）を破る。エラー写像側でも固定しているが、command本体を
        /// 通した経路でも崩れないことをここで見る。
        #[test]
        fn a_malformed_request_does_not_echo_the_input() {
            let temp = TempDir::new("malformed");
            let app = mock_app_with_state(LanguagePreference::Ja);
            app.state::<AppState>()
                .open_workspace(temp.path(), Arc::new(DiscardingSink))
                .expect("ワークスペースを開けない");

            let error = block_on(read_file_command(
                app.state::<AppState>(),
                ReadRequest {
                    scope_id: app.state::<AppState>().scope_id().expect("スコープがない"),
                    path: r"C:\Windows\System32\drivers\etc\hosts".to_owned(),
                },
            ))
            .expect_err("区切りが `\\` の要求が通っている");
            assert_eq!(error.code, ErrorCode::PathRejected);
            assert_eq!(error.detail, None);
            assert!(!error.message.contains("System32"), "{}", error.message);
        }

        /// 画像の発行は要素ごとに成功と失敗を返し、一部の失敗で全体を失敗させない（7.3）。
        #[test]
        fn image_resources_are_issued_per_reference() {
            let temp = TempDir::new("images");
            std::fs::create_dir(temp.path().join("docs")).expect("フォルダーの作成に失敗");
            std::fs::write(
                temp.path().join("docs/a.png"),
                include_bytes!("../image/fixtures/sample.png"),
            )
            .expect("書込みに失敗");
            let app = mock_app_with_state(LanguagePreference::Ja);
            app.state::<AppState>()
                .open_workspace(temp.path(), Arc::new(DiscardingSink))
                .expect("ワークスペースを開けない");

            let resources = block_on(issue_image_resources_command(
                app.state::<AppState>(),
                ImageResourceRequest {
                    scope_id: app.state::<AppState>().scope_id().expect("スコープがない"),
                    document_path: "docs/note.md".to_owned(),
                    references: vec![
                        "a.png".to_owned(),
                        "missing.png".to_owned(),
                        r"C:\Windows\secret.png".to_owned(),
                    ],
                },
            ))
            .expect("発行が失敗した");

            assert_eq!(resources.len(), 3);
            let ImageResource::Issued {
                reference,
                resource_id,
            } = &resources[0]
            else {
                panic!("発行されない: {:?}", resources[0]);
            };
            assert_eq!(reference, "a.png");
            // 発行したIDはワークスペースの対応表から引ける。
            assert_eq!(
                app.state::<AppState>()
                    .workspace()
                    .with_images(|_, images| images.lookup(resource_id))
                    .flatten()
                    .as_deref(),
                Some("docs/a.png")
            );

            let codes: Vec<Option<ErrorCode>> = resources
                .iter()
                .map(|resource| match resource {
                    ImageResource::Issued { .. } => None,
                    ImageResource::Failed { error, .. } => Some(error.code),
                })
                .collect();
            assert_eq!(
                codes,
                vec![
                    None,
                    Some(ErrorCode::FileNotFound),
                    Some(ErrorCode::PathRejected)
                ]
            );
            // 失敗の `message` と `detail` へ参照を載せない（5.3、7.1）。
            for resource in &resources {
                if let ImageResource::Failed { error, .. } = resource {
                    assert_eq!(error.detail, None);
                    assert!(!error.message.contains("secret"), "{}", error.message);
                }
            }
        }

        /// ワークスペースを開いていなければ、発行も `WorkspaceNotFound` を返す。
        #[test]
        fn issuing_without_a_workspace_is_reported() {
            let app = mock_app_with_state(LanguagePreference::Ja);

            let error = block_on(issue_image_resources_command(
                app.state::<AppState>(),
                ImageResourceRequest {
                    scope_id: "scope".to_owned(),
                    document_path: "a.md".to_owned(),
                    references: vec!["a.png".to_owned()],
                },
            ))
            .expect_err("開いていないのに発行が成功した");
            assert_eq!(error.code, ErrorCode::WorkspaceNotFound);
        }

        /// loose tab（9.1）は所在フォルダーを暗黙のルートとする。ワークスペースの外のファイルを、
        /// そのスコープIDで読み、相対リンクで移った先の文書を読める。暗黙のルートの外は読めない。
        /// スコープを閉じると、以後の読込は `WorkspaceNotFound` になる。
        #[test]
        fn a_loose_scope_reads_within_its_implicit_root() {
            let temp = TempDir::new("loose");
            let workspace = temp.path().join("ws");
            let outside = temp.path().join("outside");
            std::fs::create_dir_all(&workspace).expect("フォルダーの作成に失敗");
            std::fs::create_dir_all(outside.join("sub")).expect("フォルダーの作成に失敗");
            std::fs::write(outside.join("note.md"), b"# note\n").expect("書込みに失敗");
            std::fs::write(outside.join("sub/b.md"), b"# b\n").expect("書込みに失敗");
            std::fs::write(temp.path().join("secret.md"), b"# secret\n").expect("書込みに失敗");
            let app = mock_app_with_state(LanguagePreference::Ja);
            let state = app.state::<AppState>();
            state
                .open_workspace(&workspace, Arc::new(DiscardingSink))
                .expect("ワークスペースを開けない");
            let opened = state
                .open_loose(&outside.join("note.md"), Arc::new(DiscardingSink))
                .expect("loose tabを開けない");
            let read = |path: &str| {
                block_on(read_file_command(
                    app.state::<AppState>(),
                    ReadRequest {
                        scope_id: opened.scope_id.clone(),
                        path: path.to_owned(),
                    },
                ))
            };

            assert_eq!(read("note.md").expect("読込が失敗した").text, "# note\n");
            assert_eq!(read("sub/b.md").expect("読込が失敗した").text, "# b\n");
            // 暗黙のルートの外（親フォルダー）は、`..` を含む相対パスとして拒否される。
            assert_eq!(
                read("../secret.md").expect_err("境界外を読めた").code,
                ErrorCode::PathRejected
            );

            block_on(close_loose_scope_command(
                app.state::<AppState>(),
                opened.scope_id.clone(),
            ))
            .expect("スコープを閉じられない");
            assert_eq!(
                read("note.md").expect_err("閉じたスコープを読めた").code,
                ErrorCode::WorkspaceNotFound
            );
        }

        /// 読込は、loose tabの監視を付け替えない。付け替えは、Frontendが読込の応答を採用したときに
        /// 求める `watch_loose_document_command` で行う（6.4）。読んだ応答をFrontendが捨てることが
        /// あり、その文書へ監視が移ると、表示中の文書の更新を検知できなくなる。
        #[test]
        fn a_read_does_not_move_the_watch_but_the_confirmation_does() {
            use std::sync::Mutex;

            struct RecordingSink(Mutex<Vec<String>>);

            impl ChangeSink for RecordingSink {
                fn file_change(&self, event: crate::ipc::types::FileChangeEvent) {
                    if let crate::ipc::types::FileChange::FileModified { path } = event.change {
                        self.0.lock().unwrap().push(path);
                    }
                }
                fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
                fn images_changed(&self, _scope_id: &str) {}
            }

            let temp = TempDir::new("loose-retarget");
            std::fs::create_dir_all(temp.path().join("sub")).expect("フォルダーの作成に失敗");
            std::fs::write(
                temp.path().join("note.md"),
                b"# note
",
            )
            .expect("書込みに失敗");
            std::fs::write(
                temp.path().join("sub/b.md"),
                b"# b
",
            )
            .expect("書込みに失敗");
            let app = mock_app_with_state(LanguagePreference::Ja);
            let state = app.state::<AppState>();
            let recording = Arc::new(RecordingSink(Mutex::new(Vec::new())));
            let opened = state
                .open_loose(
                    &temp.path().join("note.md"),
                    Arc::clone(&recording) as Arc<dyn ChangeSink>,
                )
                .expect("loose tabを開けない");
            let wait_for = |path: &str| {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
                while std::time::Instant::now() < deadline {
                    if recording.0.lock().unwrap().iter().any(|seen| seen == path) {
                        return true;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                false
            };

            // 別の文書を読んでも、監視は元の文書のままである。
            block_on(read_file_command(
                app.state::<AppState>(),
                ReadRequest {
                    scope_id: opened.scope_id.clone(),
                    path: "sub/b.md".to_owned(),
                },
            ))
            .expect("読込が失敗した");
            std::fs::write(
                temp.path().join("note.md"),
                b"# note2
",
            )
            .expect("書込みに失敗");
            assert!(wait_for("note.md"), "読んだだけで、監視が動いている");

            // Frontendが読込を採用したと知らせると、その文書へ付け替わる。
            block_on(watch_loose_document_command(
                app.state::<AppState>(),
                LooseWatchRequest {
                    scope_id: opened.scope_id,
                    path: "sub/b.md".to_owned(),
                    tab_id: "tab-1".to_owned(),
                    generation: 1,
                },
            ))
            .expect("付け替えられない");
            std::fs::write(
                temp.path().join("sub/b.md"),
                b"# b2
",
            )
            .expect("書込みに失敗");
            assert!(wait_for("sub/b.md"), "確認のあとも、付け替わっていない");
        }

        /// スコープIDは、ワークスペースの切り替え前のものでは引けない。切り替える前に発行した
        /// 要求が、切り替え後の別のワークスペースの同じ相対パスへ当たらない（6.4）。
        #[test]
        fn a_request_for_a_previous_workspace_scope_is_rejected() {
            let temp = TempDir::new("stale-scope");
            std::fs::write(temp.path().join("note.md"), b"# note\n").expect("書込みに失敗");
            let app = mock_app_with_state(LanguagePreference::Ja);
            let state = app.state::<AppState>();
            state
                .open_workspace(temp.path(), Arc::new(DiscardingSink))
                .expect("ワークスペースを開けない");
            let previous = state.scope_id().expect("スコープがない");
            state
                .open_workspace(temp.path(), Arc::new(DiscardingSink))
                .expect("ワークスペースを開き直せない");

            let error = block_on(read_file_command(
                app.state::<AppState>(),
                ReadRequest {
                    scope_id: previous,
                    path: "note.md".to_owned(),
                },
            ))
            .expect_err("切り替え前のスコープで読めた");

            assert_eq!(error.code, ErrorCode::WorkspaceNotFound);
        }

        /// ワークスペースのスコープIDでは、`close_loose_scope_command` はワークスペースを閉じない。
        #[test]
        fn closing_a_loose_scope_never_closes_the_workspace() {
            let temp = TempDir::new("keep-workspace");
            let app = mock_app_with_state(LanguagePreference::Ja);
            let state = app.state::<AppState>();
            state
                .open_workspace(temp.path(), Arc::new(DiscardingSink))
                .expect("ワークスペースを開けない");

            block_on(close_loose_scope_command(
                app.state::<AppState>(),
                state.scope_id().expect("スコープがない"),
            ))
            .expect("スコープを閉じられない");

            assert!(state.workspace().with(|_| ()).is_some());
        }

        /// 設定の取得は現在のUI言語を添え、更新は取得へ反映される（11.1）。
        #[test]
        fn ui_settings_are_read_and_updated() {
            let temp = TempDir::new("settings");
            let app = mock_app_with_state(LanguagePreference::En);
            let (store, _) =
                SettingsStore::open(temp.path().to_owned(), Box::new(|error| panic!("{error}")));
            app.manage(store);
            let recents = RecentFolders::new();
            recents.sync(&["C:\\Users\\dev\\docs".to_owned()]);
            app.manage(recents);

            update_ui_settings_command(
                app.state::<SettingsStore>(),
                UiSettingsUpdate {
                    sidebar_visible: Some(false),
                    ..UiSettingsUpdate::default()
                },
            );
            let ui = get_ui_settings_command(
                app.state::<AppState>(),
                app.state::<SettingsStore>(),
                app.state::<RecentFolders>(),
            );

            assert!(!ui.sidebar_visible);
            assert_eq!(ui.effective_language, Language::En);
            // 最近使ったフォルダーは、絶対パスを含まないIDと表示名で渡す。
            assert_eq!(ui.recent_folders.len(), 1);
            assert_eq!(ui.recent_folders[0].label, "dev\\docs");
            assert!(!ui.recent_folders[0].id.contains("Users"));
            app.state::<SettingsStore>().flush();
        }

        /// UI言語は応答の文言に反映される（10.5）。
        #[test]
        fn the_response_message_follows_the_language() {
            let app = mock_app_with_state(LanguagePreference::En);

            let error = block_on(scan_directory_command(
                app.state::<AppState>(),
                ScanRequest {
                    path: String::new(),
                },
            ))
            .expect_err("開いていないのに走査が成功した");
            assert_eq!(
                error.message,
                crate::ipc::message::message(ErrorCode::WorkspaceNotFound, Language::En)
            );
        }
    }
}
