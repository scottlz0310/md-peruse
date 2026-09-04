//! `IpcError` の表示用メッセージ（design-decisions.md 5.3、10.5）。
//!
//! Rust側が現在のUI言語で組み立てる。ネイティブメニューとネイティブダイアログの文言を
//! どのみちRust側が持ち、IPCが成立しない場面の表示もRust側で行うため、辞書を両側へ
//! 分けると同じ文言が二重になる。
//!
//! `match` で全 `ErrorCode` を列挙する。`code` を増やしたときの文言の書き漏らしを
//! コンパイラが検出するためであり、ワイルドカードの腕は置かない。
//!
//! 文言へネイティブ絶対パスを含めない。対象を示すときはワークスペースルートからの
//! 相対パスを使う（7.1）。ここに置くのは対象を含まない定型文であり、対象を添える場合は
//! 呼び出し側が `detail` へ相対パスを入れる。

use crate::i18n::Language;
use crate::ipc::error::{ErrorCode, IpcError};

/// エラーコードに対応する表示用メッセージを返す。
pub fn message(code: ErrorCode, language: Language) -> &'static str {
    match language {
        Language::Ja => japanese(code),
        Language::En => english(code),
    }
}

/// `IpcError` を組み立てる。
pub fn ipc_error(code: ErrorCode, language: Language, detail: Option<String>) -> IpcError {
    IpcError {
        code,
        message: message(code, language).to_owned(),
        detail,
    }
}

fn japanese(code: ErrorCode) -> &'static str {
    match code {
        ErrorCode::WorkspaceAccessDenied => "フォルダーへアクセスできません。",
        ErrorCode::WorkspaceNotFound => {
            "フォルダーが見つかりません。移動または削除された可能性があります。"
        }
        ErrorCode::PathOutsideWorkspace => "開いているフォルダーの外は表示できません。",
        ErrorCode::PathRejected => "この形式のパスは扱えません。",
        ErrorCode::DirectoryAccessDenied => "このフォルダーへアクセスできません。",
        ErrorCode::DirectoryNotFound => "このフォルダーが見つかりません。",
        ErrorCode::FileNotFound => "ファイルが見つかりません。",
        ErrorCode::FileAccessDenied => "ファイルへアクセスできません。",
        ErrorCode::FileLocked => "他のプログラムがファイルを使用中です。",
        ErrorCode::FileTooLarge => "ファイルが大きすぎます。10 MiBまでのMarkdownを表示できます。",
        ErrorCode::DecodeFailed => {
            "文字コードを判別できません。UTF-8、またはBOM付きのUTF-16で保存してください。"
        }
        ErrorCode::ImageUnsupportedFormat => "この形式の画像は表示できません。",
        ErrorCode::ImageTooLarge => "画像が大きすぎます。32 MiBまでの画像を表示できます。",
        ErrorCode::ImagePixelLimitExceeded => "画像の寸法が大きすぎます。",
        ErrorCode::ImageDecodeFailed => "画像を読み込めません。",
        ErrorCode::WatcherOverflow => {
            "変更が多すぎて追いきれませんでした。表示を更新してください。"
        }
        ErrorCode::WatcherStopped => {
            "ファイルの監視が停止しました。フォルダーを開き直してください。"
        }
        ErrorCode::SettingsCorrupted => "設定ファイルを読み取れません。設定を初期値に戻しました。",
        ErrorCode::RecentFolderNotFound => "この項目は開けません。一覧を取得し直してください。",
    }
}

fn english(code: ErrorCode) -> &'static str {
    match code {
        ErrorCode::WorkspaceAccessDenied => "Cannot access this folder.",
        ErrorCode::WorkspaceNotFound => "Folder not found. It may have been moved or deleted.",
        ErrorCode::PathOutsideWorkspace => "Cannot show anything outside the open folder.",
        ErrorCode::PathRejected => "This path format is not supported.",
        ErrorCode::DirectoryAccessDenied => "Cannot access this folder.",
        ErrorCode::DirectoryNotFound => "This folder no longer exists.",
        ErrorCode::FileNotFound => "File not found.",
        ErrorCode::FileAccessDenied => "Cannot access this file.",
        ErrorCode::FileLocked => "Another program is using this file.",
        ErrorCode::FileTooLarge => "File is too large. Markdown files up to 10 MiB can be shown.",
        ErrorCode::DecodeFailed => {
            "Cannot detect the character encoding. Save the file as UTF-8, or as UTF-16 with a BOM."
        }
        ErrorCode::ImageUnsupportedFormat => "This image format is not supported.",
        ErrorCode::ImageTooLarge => "Image is too large. Images up to 32 MiB can be shown.",
        ErrorCode::ImagePixelLimitExceeded => "Image dimensions are too large.",
        ErrorCode::ImageDecodeFailed => "Cannot load this image.",
        ErrorCode::WatcherOverflow => "Too many changes to follow. Reload to refresh the view.",
        ErrorCode::WatcherStopped => "File watching stopped. Reopen the folder to resume.",
        ErrorCode::SettingsCorrupted => {
            "Cannot read the settings file. Settings were reset to their defaults."
        }
        ErrorCode::RecentFolderNotFound => {
            "Cannot open this entry. Refresh the list and try again."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 文言を持たせるすべての `ErrorCode`。
    ///
    /// `message` の `match` は列挙の漏れをコンパイラが検出するが、この一覧そのものの
    /// 漏れは検出できない。`ErrorCode` を増やしたときはここへも足す。
    const ALL_CODES: [ErrorCode; 19] = [
        ErrorCode::WorkspaceAccessDenied,
        ErrorCode::WorkspaceNotFound,
        ErrorCode::PathOutsideWorkspace,
        ErrorCode::PathRejected,
        ErrorCode::DirectoryAccessDenied,
        ErrorCode::DirectoryNotFound,
        ErrorCode::FileNotFound,
        ErrorCode::FileAccessDenied,
        ErrorCode::FileLocked,
        ErrorCode::FileTooLarge,
        ErrorCode::DecodeFailed,
        ErrorCode::ImageUnsupportedFormat,
        ErrorCode::ImageTooLarge,
        ErrorCode::ImagePixelLimitExceeded,
        ErrorCode::ImageDecodeFailed,
        ErrorCode::WatcherOverflow,
        ErrorCode::WatcherStopped,
        ErrorCode::SettingsCorrupted,
        ErrorCode::RecentFolderNotFound,
    ];

    #[test]
    fn every_code_has_a_message_in_both_languages() {
        for code in ALL_CODES {
            for language in [Language::Ja, Language::En] {
                let text = message(code, language);
                assert!(!text.is_empty(), "{code:?} / {language:?} の文言が空である");
            }
        }
    }

    #[test]
    fn messages_do_not_leak_native_paths() {
        // 定型文にネイティブ絶対パスの断片が混じっていないことを確かめる（7.1）。
        for code in ALL_CODES {
            for language in [Language::Ja, Language::En] {
                let text = message(code, language);
                assert!(!text.contains('\\'), "{code:?} がパス区切りを含む: {text}");
                assert!(
                    !text.contains(":\\"),
                    "{code:?} がドライブ表記を含む: {text}"
                );
            }
        }
    }

    #[test]
    fn ipc_error_carries_the_code_and_detail() {
        let error = ipc_error(
            ErrorCode::DirectoryNotFound,
            Language::Ja,
            Some("docs/sub".to_owned()),
        );
        assert_eq!(error.code, ErrorCode::DirectoryNotFound);
        assert_eq!(error.message, japanese(ErrorCode::DirectoryNotFound));
        assert_eq!(error.detail.as_deref(), Some("docs/sub"));
    }
}
