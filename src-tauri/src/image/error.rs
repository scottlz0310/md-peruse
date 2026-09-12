//! 画像を発行・配信できない理由（design-decisions.md 5.4）。
//!
//! 発行時（IPC command）と配信時（custom protocol）で区分を一致させるため、両者が同じ列挙を
//! 返し、同じ写像で `ErrorCode` を得る。配信時はさらに `ErrorCode` からHTTPのステータスへ写す。

use std::io;

use super::format::ImageRejection;
use crate::ipc::error::ErrorCode;
use crate::path_guard::{PathRejection, ResolveError};

/// 画像を発行・配信できない理由。
///
/// パスの失敗は走査・読込と同じ区分（`ResolveError`）で、画像の失敗は `ImageRejection` で表す。
#[derive(Debug)]
pub enum ImageError {
    Resolve(ResolveError),
    Rejected(ImageRejection),
}

impl From<ResolveError> for ImageError {
    fn from(error: ResolveError) -> Self {
        Self::Resolve(error)
    }
}

impl From<ImageRejection> for ImageError {
    fn from(rejection: ImageRejection) -> Self {
        Self::Rejected(rejection)
    }
}

impl ImageError {
    /// 対応する `ErrorCode`。
    ///
    /// 見つからないことは `FileNotFound` で表す。参照の書き誤りが最も起こりやすい失敗であり、
    /// 「読み込めない」と区別して示す価値がある。それ以外のI/Oの失敗（アクセス拒否、共有違反、
    /// フォルダーを指している）は `ImageDecodeFailed` へまとめる。画像の表示位置で利用者が
    /// 取れる対応は変わらないためである。
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::Rejected(rejection) => rejection.code(),
            Self::Resolve(ResolveError::Rejected(PathRejection::Malformed)) => {
                ErrorCode::PathRejected
            }
            Self::Resolve(ResolveError::Rejected(PathRejection::Outside)) => {
                ErrorCode::PathOutsideWorkspace
            }
            Self::Resolve(ResolveError::Io(cause)) if cause.kind() == io::ErrorKind::NotFound => {
                ErrorCode::FileNotFound
            }
            Self::Resolve(ResolveError::Io(_)) => ErrorCode::ImageDecodeFailed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_errors_map_to_image_codes() {
        let cases = [
            (
                ImageError::Rejected(ImageRejection::UnsupportedFormat),
                ErrorCode::ImageUnsupportedFormat,
            ),
            (
                ImageError::Rejected(ImageRejection::TooLarge),
                ErrorCode::ImageTooLarge,
            ),
            (
                ImageError::Rejected(ImageRejection::PixelLimitExceeded),
                ErrorCode::ImagePixelLimitExceeded,
            ),
            (
                ImageError::Rejected(ImageRejection::Decode),
                ErrorCode::ImageDecodeFailed,
            ),
            (
                ImageError::Resolve(ResolveError::Rejected(PathRejection::Malformed)),
                ErrorCode::PathRejected,
            ),
            (
                ImageError::Resolve(ResolveError::Rejected(PathRejection::Outside)),
                ErrorCode::PathOutsideWorkspace,
            ),
            (
                ImageError::Resolve(ResolveError::Io(io::Error::from(io::ErrorKind::NotFound))),
                ErrorCode::FileNotFound,
            ),
            // Markdown用の `FileAccessDenied` や `FileLocked` へは倒さない。
            (
                ImageError::Resolve(ResolveError::Io(io::Error::from(
                    io::ErrorKind::PermissionDenied,
                ))),
                ErrorCode::ImageDecodeFailed,
            ),
            (
                ImageError::Resolve(ResolveError::Io(io::Error::from_raw_os_error(32))),
                ErrorCode::ImageDecodeFailed,
            ),
        ];
        for (error, expected) in cases {
            assert_eq!(error.code(), expected, "{error:?}");
        }
    }
}
