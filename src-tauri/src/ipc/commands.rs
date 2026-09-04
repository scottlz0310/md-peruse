//! Frontendから呼ぶTauri command（design-decisions.md 5.3）。
//!
//! Frontendから受け取ったパスはここで再検証する。汎用のファイルシステムAPIは公開せず、
//! 走査と読込に必要なcommandだけを置く。
//!
//! commandの戻り値の失敗は `IpcError` とし、Frontendは `code` で分岐する。表示場所
//! （ネイティブダイアログ、プレビュー領域、ツリー項目、文書内要素）はFrontendが呼び出しの
//! 文脈から決めるため、応答へ含めない。

use std::io;

use tauri::State;

use crate::i18n::Language;
use crate::ipc::error::{ErrorCode, IpcError};
use crate::ipc::message::ipc_error;
use crate::ipc::types::{ScanRequest, ScanResult};
use crate::path_guard::{PathRejection, ResolveError};
use crate::scan::scan_directory;
use crate::state::AppState;

/// ディレクトリ1階層を走査する。
///
/// ルート直下は `path` に空文字を渡す。サブフォルダーは展開時にその都度呼ぶ（6.2）。
///
/// 応答の陳腐化はFrontendが持つワークスペース世代とパス世代で判定する。要求へ世代を
/// 載せないのは、`await invoke()` が要求と応答を対応付けるためである（5.3）。
#[tauri::command]
pub fn scan_directory_command(
    state: State<'_, AppState>,
    request: ScanRequest,
) -> Result<ScanResult, IpcError> {
    let language = state.language();
    let result = state.with_workspace(|root| scan_directory(root, &request.path));
    // ワークスペースを開いていない状態で走査を求められた場合。Frontendはwelcome状態で
    // ツリーを出さないため通常は起きないが、開いていないことをルートの不在として返す。
    let Some(result) = result else {
        return Err(ipc_error(ErrorCode::WorkspaceNotFound, language, None));
    };
    result.map_err(|error| scan_error(&error, &request.path, language))
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
}
