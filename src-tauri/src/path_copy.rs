use std::path::Path;

use crate::ipc::error::ErrorCode;
use crate::ipc::types::{CopyPathFormat, CopyPathRequest};
use crate::path_guard::{PathRejection, ResolveError, WorkspaceRoot};
use crate::state::WorkspaceHandle;

/// 検証と書込みを同じスコープのロック内で行い、切替後の対象へコピーしない。
pub fn copy_path(
    workspace: &WorkspaceHandle,
    request: &CopyPathRequest,
    write: impl FnOnce(&str) -> Result<(), ErrorCode>,
) -> Result<(), ErrorCode> {
    workspace
        .with_copy_target(&request.scope_id, &request.path, request.format, |root| {
            let text = resolve_text(root, &request.path, request.format)?;
            write(&text)
        })
        .ok_or(ErrorCode::WorkspaceNotFound)?
}

fn resolve_text(
    root: &WorkspaceRoot,
    path: &str,
    format: CopyPathFormat,
) -> Result<String, ErrorCode> {
    let absolute = root.resolve(path).map_err(|error| match error {
        ResolveError::Rejected(PathRejection::Malformed) => ErrorCode::PathRejected,
        ResolveError::Rejected(PathRejection::Outside) => ErrorCode::PathOutsideWorkspace,
        ResolveError::Io(error) if error.kind() == std::io::ErrorKind::NotFound => {
            ErrorCode::FileNotFound
        }
        ResolveError::Io(_) => ErrorCode::FileAccessDenied,
    })?;
    if !absolute.is_dir() && !crate::file_kind::is_markdown_path(&absolute.to_string_lossy()) {
        return Err(ErrorCode::PathRejected);
    }
    match format {
        CopyPathFormat::Absolute => Ok(display_path(&absolute)),
        CopyPathFormat::Relative => Ok(if path.is_empty() {
            ".".to_owned()
        } else {
            path.to_owned()
        }),
    }
}

fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_owned()
    }
}

/// CF_UNICODETEXTの所有権はSetClipboardData成功時にOSへ移る。
pub fn write_text(owner: isize, text: &str) -> windows::core::Result<()> {
    use windows::Win32::Foundation::{
        ERROR_SUCCESS, GetLastError, GlobalFree, HANDLE, HGLOBAL, HWND,
    };
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GMEM_MOVEABLE, GlobalAlloc, GlobalLock, GlobalUnlock};

    struct Allocation(HGLOBAL);
    impl Drop for Allocation {
        fn drop(&mut self) {
            // 所有権をOSへ渡せなかった場合の後始末。
            unsafe {
                let _ = GlobalFree(Some(self.0));
            }
        }
    }
    struct Clipboard;
    impl Drop for Clipboard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }
    let encoded: Vec<u16> = text.encode_utf16().chain([0]).collect();
    unsafe {
        let memory = Allocation(GlobalAlloc(GMEM_MOVEABLE, encoded.len() * 2)?);
        let buffer = GlobalLock(memory.0).cast::<u16>();
        if buffer.is_null() {
            return Err(windows::core::Error::from_thread());
        }
        std::ptr::copy_nonoverlapping(encoded.as_ptr(), buffer, encoded.len());
        // 最後のロック解除は成功時も0を返すため、戻り値だけでは成否を判定できない。
        if GlobalUnlock(memory.0).is_err() && GetLastError() != ERROR_SUCCESS {
            return Err(windows::core::Error::from_thread());
        }
        OpenClipboard(Some(HWND(owner as *mut _)))?;
        let clipboard = Clipboard;
        EmptyClipboard()?;
        const CF_UNICODETEXT: u32 = 13;
        SetClipboardData(CF_UNICODETEXT, Some(HANDLE(memory.0.0)))?;
        std::mem::forget(memory);
        let result = CloseClipboard();
        std::mem::forget(clipboard);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pasteable_windows_paths() {
        for (input, expected) in [
            (
                r"\\?\C:\資料 フォルダー\文書.md",
                r"C:\資料 フォルダー\文書.md",
            ),
            (r"\\?\UNC\server\share\文書.md", r"\\server\share\文書.md"),
            (r"C:\a.md", r"C:\a.md"),
        ] {
            assert_eq!(display_path(Path::new(input)), expected);
        }
    }
}
