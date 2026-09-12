//! 画像参照1件に対するresource IDの発行（design-decisions.md 5.4、7.3）。
//!
//! 参照の解決、境界の検証、形式と上限の検証を順に通し、通ったものだけにIDを発行する。
//! 発行時にファイル全体は読まない。形式と寸法はヘッダーから判定する（`format::validate_reader`）。
//! 配信時は同じ規則をファイル全体に対してもう一度通す。検証と配信の間に対象が置換されうる
//! ためである（5.4）。

use std::fs::File;
use std::io::{self, BufReader};

use super::error::ImageError;
use super::format;
use super::reference;
use super::resource::ImageResources;
use crate::path_guard::{ResolveError, WorkspaceRoot};

/// `document_path` の文書に書かれた `reference` に対してIDを発行する。
pub fn issue(
    root: &WorkspaceRoot,
    resources: &ImageResources,
    document_path: &str,
    reference: &str,
) -> Result<String, ImageError> {
    let relative = reference::resolve(document_path, reference).map_err(ResolveError::Rejected)?;
    let absolute = root.resolve(&relative)?;
    let file = File::open(&absolute).map_err(ResolveError::Io)?;
    let byte_len = file.metadata().map_err(ResolveError::Io)?.len();
    format::validate_reader(BufReader::new(file), byte_len)?;
    // 世代はファイルシステム上の表記で持つ。参照の表記（`IMG.png`）と監視イベントの表記
    // （`img.png`）が食い違っても、同じファイルの世代として進めるためである。
    // 検証の後に消された場合は、見つからないものとして扱う。
    let canonical = root
        .relativize(&absolute)
        .ok_or_else(|| ResolveError::Io(io::Error::from(io::ErrorKind::NotFound)))?;
    Ok(resources.issue(&canonical))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::image::format::ImageRejection;
    use crate::path_guard::PathRejection;
    use std::fs;
    use std::path::{Path, PathBuf};

    const PNG: &[u8] = include_bytes!("fixtures/sample.png");
    const TIFF: &[u8] = include_bytes!("fixtures/sample.tiff");
    const WIDE: &[u8] = include_bytes!("fixtures/wide.png");

    /// テスト用の一時フォルダー。終了時に削除する。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("md-peruse-issue-{name}-{}", std::process::id()));
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

    /// 文書からの相対参照を解決し、ファイルシステム上の表記でIDを発行する。
    #[test]
    fn a_valid_reference_is_issued_under_its_canonical_path() {
        let temp = TempDir::new("valid");
        fs::create_dir_all(temp.path().join("docs/img")).unwrap();
        fs::write(temp.path().join("docs/img/Figure.png"), PNG).unwrap();
        let root = WorkspaceRoot::open(temp.path()).unwrap();
        let resources = ImageResources::new();

        let id = issue(&root, &resources, "docs/a.md", "img/FIGURE.PNG").expect("発行できない");

        assert_eq!(
            resources.lookup(&id).as_deref(),
            Some("docs/img/Figure.png")
        );
        // 別の文書から別の表記で参照しても、同じファイルなら同じIDになる。
        assert_eq!(
            issue(&root, &resources, "b.md", "/docs/img/Figure.png").unwrap(),
            id
        );
    }

    /// 発行できない理由は、パスの区分と画像の区分に分かれる。
    #[test]
    fn failures_keep_their_cause() {
        let temp = TempDir::new("failures");
        let root_directory = temp.path().join("root");
        fs::create_dir_all(root_directory.join("sub")).unwrap();
        fs::write(temp.path().join("outside.png"), PNG).unwrap();
        fs::write(root_directory.join("a.tiff"), TIFF).unwrap();
        fs::write(root_directory.join("wide.png"), WIDE).unwrap();
        let root = WorkspaceRoot::open(&root_directory).unwrap();
        let resources = ImageResources::new();

        let issued = |reference: &str| issue(&root, &resources, "a.md", reference);

        assert!(matches!(
            issued("https://example.com/a.png"),
            Err(ImageError::Resolve(ResolveError::Rejected(
                PathRejection::Malformed
            )))
        ));
        assert!(matches!(
            issued("../outside.png"),
            Err(ImageError::Resolve(ResolveError::Rejected(
                PathRejection::Outside
            )))
        ));
        assert!(matches!(
            issued("missing.png"),
            Err(ImageError::Resolve(ResolveError::Io(error))) if error.kind() == io::ErrorKind::NotFound
        ));
        // フォルダーはファイルとして開けない。
        assert!(matches!(
            issued("sub"),
            Err(ImageError::Resolve(ResolveError::Io(_)))
        ));
        assert!(matches!(
            issued("a.tiff"),
            Err(ImageError::Rejected(ImageRejection::UnsupportedFormat))
        ));
        assert!(matches!(
            issued("wide.png"),
            Err(ImageError::Rejected(ImageRejection::PixelLimitExceeded))
        ));
    }
}
