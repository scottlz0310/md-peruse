//! ワークスペース境界の検証（design-decisions.md 7.1）。
//!
//! Frontendとの間でやり取りするパスはワークスペースルートからの相対パスであり、区切りは
//! `/` とする（5.3、7.1）。ネイティブ絶対パスをFrontendへ渡さないため、絶対パスへの
//! 解決と境界の判定はすべてRust側のこのモジュールで行う。
//!
//! 正規化は `std::fs::canonicalize` へ寄せる。7.1が求める正規化のうち、絶対パス化、
//! 8.3形式の短い名前の解決、大文字小文字の吸収、`..` の解決、symlinkとjunctionの解決を
//! すべて行うことを実測で確認した（Windows 11 26200、Rust 1.98.1）。
//!
//! Unicode正規化（NFC / NFD）は行わない。NTFSは名前を正規化せず、`パ`（U+30D1）と
//! `ハ` + 濁点（U+30CF U+309A）は別のファイルとして共存する（実測）。ルートも対象も
//! `canonicalize` を通した結果どうしで比較するため、比較する2つの表記はいずれも
//! ファイルシステムが返したものであり、正規化の差はそもそも生じない。ここで正規化を
//! 挟むと、別のファイルを同一視する側の誤りを新たに作ることになる。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Windowsのファイル名に使えない文字（design-decisions.md 7.1、7.2）。
///
/// `:` は代替データストリーム表記（`file.md:stream`）を兼ねて拒否する。`/` と `\` は
/// 区切りとして別に扱うためここには含めない。制御文字は別途判定する。
/// Frontendのリンク解決（`src/markdown/link-target.ts`）と同じ集合である。
const INVALID_NAME_CHARS: [char; 7] = [':', '*', '?', '"', '<', '>', '|'];

/// Frontendから受け取ったパスを受け付けられない理由。
///
/// `ErrorCode`（`PathRejected` と `PathOutsideWorkspace`）へはcommand層で写像する。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathRejection {
    /// 形式を受け付けられない。区切りの `\`、`.` と `..`、空のセグメント、
    /// ファイル名に使えない文字、代替データストリーム表記、末尾のドットや空白が該当する。
    Malformed,
    /// 解決した先がワークスペースの外を指している。境界内のパスを経由して
    /// junctionやsymlinkで外へ出る場合を含む。
    Outside,
}

/// パスの解決に失敗した理由。
#[derive(Debug)]
pub enum ResolveError {
    Rejected(PathRejection),
    /// ファイルシステム側の失敗。
    ///
    /// `ErrorCode` への写像は行わない。同じ「見つからない」でも、対象がディレクトリなら
    /// `DirectoryNotFound`、ファイルなら `FileNotFound` であり、区別できるのは対象の
    /// 種別を知る呼び出し側だけであるためである（design-decisions.md 5.3）。
    Io(io::Error),
}

impl From<PathRejection> for ResolveError {
    fn from(rejection: PathRejection) -> Self {
        Self::Rejected(rejection)
    }
}

/// 開いているワークスペースのルート。
///
/// 保持するのは `canonicalize` 済みの絶対パスであり、Frontendへは渡さない（7.1）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceRoot {
    path: PathBuf,
}

impl WorkspaceRoot {
    /// フォルダーをワークスペースルートとして開く。
    ///
    /// ルート自身がjunctionやsymlinkであることは許容し、解決した先をルートとして扱う。
    /// 利用者が明示的に選んだフォルダーであり、7.1が断つのは「境界内から外への逸脱」で
    /// あって、境界そのものの置き場所ではないためである。
    pub fn open(path: &Path) -> io::Result<Self> {
        let path = fs::canonicalize(path)?;
        if !path.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotADirectory,
                "ワークスペースにはフォルダーを指定する",
            ));
        }
        Ok(Self { path })
    }

    /// ルートの絶対パス。
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// ワークスペース相対パスを絶対パスへ解決する。
    ///
    /// 空文字はルート自身を指す（`ScanRequest` のルート表現）。
    ///
    /// 実在しないパスは `canonicalize` が失敗するため、解決できるのは実在するものだけで
    /// ある。検証と実際の読込の間に対象が置換される競合は残るが、返すのは `..` を含まない
    /// verbatimパスであり、境界外へ出るには経路上のフォルダーそのものを差し替える必要が
    /// ある（7.1）。
    pub fn resolve(&self, relative: &str) -> Result<PathBuf, ResolveError> {
        let segments = validate_relative_path(relative)?;
        let mut target = self.path.clone();
        for segment in segments {
            target.push(segment);
        }
        let target = fs::canonicalize(&target).map_err(ResolveError::Io)?;
        if !is_within(&self.path, &target) {
            return Err(PathRejection::Outside.into());
        }
        Ok(target)
    }

    /// 絶対パスをワークスペース相対パスへ直す。
    ///
    /// Frontendへ渡す `FileNode.path` などはこの形式である。境界外のパスには `None` を
    /// 返し、ルート自身は空文字を返す。
    pub fn relativize(&self, absolute: &Path) -> Option<String> {
        if !is_within(&self.path, absolute) {
            return None;
        }
        let segments: Vec<String> = absolute
            .components()
            .skip(self.path.components().count())
            .map(|component| component.as_os_str().to_string_lossy().into_owned())
            .collect();
        Some(segments.join("/"))
    }
}

/// ワークスペース相対パスの形式を検証し、セグメント列を返す。
///
/// ここで落とすのは文字列だけで判定できるものに限る。実在と境界は `WorkspaceRoot` が
/// ファイルシステムへ問い合わせて判定する。
///
/// 予約デバイス名（`CON`、`NUL`、`COM1` など）は拒否しない。Rustの標準ライブラリは
/// verbatimパスでファイルを開くため、`CON.md` は通常のファイルとして作成でき、
/// `read_dir` にも `canonicalize` にもそのまま現れる（実測）。拒否すると、ツリーに
/// 表示されるのに開けないファイルが生じる。
pub fn validate_relative_path(relative: &str) -> Result<Vec<&str>, PathRejection> {
    if relative.is_empty() {
        return Ok(Vec::new());
    }
    // 区切りは `/` に限る。`\` を区切りとして受け入れると、UNC表記（`\\server\share`）と
    // device path（`\\?\C:\`）の判定を後段のすべての箇所で持ち回ることになる。
    if relative.contains('\\') {
        return Err(PathRejection::Malformed);
    }
    relative.split('/').map(validate_segment).collect()
}

fn validate_segment(segment: &str) -> Result<&str, PathRejection> {
    // 空のセグメントは、先頭・末尾・連続する区切りから生じる。ルート絶対表記（`/a.md`）も
    // ここで落ちる。IPCで渡すのは常にワークスペース相対であり、ルート基準の記法は
    // Frontendのリンク解決が相対へ直してから渡す（design-decisions.md 7.2）。
    if segment.is_empty() || segment == "." || segment == ".." {
        return Err(PathRejection::Malformed);
    }
    if segment.contains(INVALID_NAME_CHARS) || segment.contains(char::is_control) {
        return Err(PathRejection::Malformed);
    }
    // 末尾のドットと空白を拒否する。Win32のパス正規化がこれらを落とすため、`a.md.` を
    // 許すと `a.md` を別名で指す経路になる（実測）。
    if segment.ends_with('.') || segment.ends_with(' ') {
        return Err(PathRejection::Malformed);
    }
    Ok(segment)
}

/// 絶対パスがルートと同じか、その配下にあるかを返す。
///
/// 比較はパスコンポーネント単位で行う。単純な前方一致では `C:\root` が `C:\rootx` を
/// 含むと誤判定する（design-decisions.md 7.1）。
///
/// 大文字小文字は区別しない。両者とも `canonicalize` 済みであればファイルシステム上の
/// 表記へ揃うが、境界の判定を表記の一致に依存させない。
pub fn is_within(root: &Path, path: &Path) -> bool {
    let mut components = path.components();
    root.components().all(|expected| {
        components.next().is_some_and(|actual| {
            actual.as_os_str().to_string_lossy().to_lowercase()
                == expected.as_os_str().to_string_lossy().to_lowercase()
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn relative_paths_are_validated() {
        let cases = [
            // ルート自身。`ScanRequest` はルートを空文字で表す。
            ("", Some(vec![])),
            ("a.md", Some(vec!["a.md"])),
            ("docs/a.md", Some(vec!["docs", "a.md"])),
            ("docs/sub/a.md", Some(vec!["docs", "sub", "a.md"])),
            // 予約デバイス名は通常のファイルとして扱う。
            ("CON.md", Some(vec!["CON.md"])),
            ("COM1.md", Some(vec!["COM1.md"])),
            // 先頭の空白は作成も解決もできるため受け入れる。
            (" leading.md", Some(vec![" leading.md"])),
            ("mid dle.md", Some(vec!["mid dle.md"])),
            // トラバーサル。
            ("..", None),
            ("../a.md", None),
            ("docs/../a.md", None),
            ("./a.md", None),
            ("docs/./a.md", None),
            // 区切りの表記。
            (r"docs\a.md", None),
            (r"\\server\share\a.md", None),
            ("/a.md", None),
            ("docs//a.md", None),
            ("a.md/", None),
            // 代替データストリーム表記とドライブ表記。
            ("a.md:stream", None),
            ("C:/a.md", None),
            // ファイル名に使えない文字。
            ("a*.md", None),
            ("a?.md", None),
            ("a\".md", None),
            ("a<b>.md", None),
            ("a|b.md", None),
            ("a\u{0}.md", None),
            ("a\tb.md", None),
            // 末尾のドットと空白。
            ("a.md.", None),
            ("a.md ", None),
            ("docs./a.md", None),
        ];
        for (input, expected) in cases {
            assert_eq!(
                validate_relative_path(input).ok(),
                expected,
                "input = {input:?}"
            );
        }
    }

    #[test]
    fn boundary_is_compared_by_component() {
        let root = Path::new(r"\\?\C:\root");
        let cases = [
            (r"\\?\C:\root", true),
            (r"\\?\C:\root\a.md", true),
            (r"\\?\C:\root\docs\a.md", true),
            // 前方一致では通ってしまう兄弟フォルダー。
            (r"\\?\C:\rootx\a.md", false),
            (r"\\?\C:\root2", false),
            (r"\\?\C:\other\a.md", false),
            // ルートより上。
            (r"\\?\C:\", false),
            // 大文字小文字は区別しない。
            (r"\\?\C:\ROOT\a.md", true),
            (r"\\?\c:\root\a.md", true),
        ];
        for (path, expected) in cases {
            assert_eq!(is_within(root, Path::new(path)), expected, "path = {path}");
        }
    }

    /// テスト用の一時フォルダー。終了時に削除する。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("md-peruse-{name}-{}", std::process::id()));
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

    /// junctionを作る。symlinkと違い、特権も開発者モードも要らない。
    fn create_junction(link: &Path, target: &Path) {
        let output = Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .expect("mklinkを実行できない");
        assert!(output.status.success(), "junctionを作成できない");
    }

    #[test]
    fn workspace_root_requires_a_directory() {
        let temp = TempDir::new("root-kind");
        fs::write(temp.path().join("a.md"), "# a").unwrap();

        assert!(WorkspaceRoot::open(temp.path()).is_ok());
        assert_eq!(
            WorkspaceRoot::open(&temp.path().join("a.md"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotADirectory
        );
        assert_eq!(
            WorkspaceRoot::open(&temp.path().join("missing"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
    }

    #[test]
    fn resolve_normalizes_short_names_and_case() {
        let temp = TempDir::new("normalize");
        let long = temp.path().join("Very Long Directory Name For Tests");
        fs::create_dir_all(&long).unwrap();
        fs::write(long.join("a.md"), "# a").unwrap();
        let root = WorkspaceRoot::open(temp.path()).unwrap();
        let expected = fs::canonicalize(long.join("a.md")).unwrap();

        // 大文字小文字の差はファイルシステム上の表記へ揃う。
        let resolved = root
            .resolve("VERY LONG DIRECTORY NAME FOR TESTS/A.MD")
            .unwrap();
        assert_eq!(resolved, expected);
        assert_eq!(
            root.relativize(&resolved).as_deref(),
            Some("Very Long Directory Name For Tests/a.md")
        );
    }

    #[test]
    fn resolve_rejects_paths_that_leave_the_workspace() {
        let temp = TempDir::new("junction");
        let root_dir = temp.path().join("root");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&root_dir).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.md"), "# secret").unwrap();
        fs::write(root_dir.join("a.md"), "# a").unwrap();
        let inside = root_dir.join("docs");
        fs::create_dir_all(&inside).unwrap();
        fs::write(inside.join("b.md"), "# b").unwrap();
        create_junction(&root_dir.join("to_outside"), &outside);
        create_junction(&root_dir.join("to_inside"), &inside);
        let root = WorkspaceRoot::open(&root_dir).unwrap();

        // 境界内を指すjunctionは解決先が内側であり、受け入れる。
        assert!(root.resolve("to_inside/b.md").is_ok());
        assert_eq!(
            root.resolve("to_inside/b.md").unwrap(),
            fs::canonicalize(inside.join("b.md")).unwrap()
        );

        // 境界外を指すjunctionは、経路自体が境界内でも拒否する。
        assert!(matches!(
            root.resolve("to_outside/secret.md"),
            Err(ResolveError::Rejected(PathRejection::Outside))
        ));
        assert!(matches!(
            root.resolve("to_outside"),
            Err(ResolveError::Rejected(PathRejection::Outside))
        ));

        // 形式で落ちるものはファイルシステムへ問い合わせるまでもない。
        assert!(matches!(
            root.resolve("../outside/secret.md"),
            Err(ResolveError::Rejected(PathRejection::Malformed))
        ));

        // 実在しないパスはファイルシステムの失敗として返す。
        assert!(matches!(
            root.resolve("missing.md"),
            Err(ResolveError::Io(error)) if error.kind() == io::ErrorKind::NotFound
        ));
    }

    #[test]
    fn relativize_returns_none_outside_the_workspace() {
        let temp = TempDir::new("relativize");
        let root_dir = temp.path().join("root");
        fs::create_dir_all(root_dir.join("docs")).unwrap();
        fs::create_dir_all(temp.path().join("rootx")).unwrap();
        let root = WorkspaceRoot::open(&root_dir).unwrap();

        assert_eq!(root.relativize(root.path()).as_deref(), Some(""));
        assert_eq!(
            root.relativize(&root.path().join("docs").join("a.md"))
                .as_deref(),
            Some("docs/a.md")
        );
        assert_eq!(
            root.relativize(&fs::canonicalize(temp.path().join("rootx")).unwrap()),
            None
        );
    }
}
