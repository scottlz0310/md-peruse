//! ディレクトリの走査（design-decisions.md 6.2、6.3）。
//!
//! 取得するのは1階層だけであり、サブフォルダーの中身は展開時に取り直す。ルート全体を
//! 起動時に再帰列挙しない。ツリーへ出すのはフォルダーと `.md` / `.markdown` に限り、
//! 非Markdownファイルは走査の時点で落とす。

use std::fs;
use std::os::windows::fs::MetadataExt;
use std::path::Path;

use crate::file_kind::is_markdown_path;
use crate::ipc::types::{FileNode, FileNodeKind, ScanResult};
use crate::natural_order::natural_cmp;
use crate::path_guard::{ResolveError, WorkspaceRoot, is_valid_name};

/// 走査から除外するフォルダー名（design-decisions.md 6.2）。
///
/// 比較は大文字小文字を区別しない。初期版ではユーザー設定から変更できない。
/// `.gitignore` の解釈は行わない。
pub const EXCLUDED_DIRECTORY_NAMES: [&str; 21] = [
    // バージョン管理
    ".git",
    ".hg",
    ".svn",
    // 依存関係
    "node_modules",
    ".venv",
    "venv",
    "vendor",
    // ビルド成果物とキャッシュ
    "target",
    "dist",
    "build",
    "out",
    "bin",
    "obj",
    ".next",
    ".turbo",
    "__pycache__",
    ".mypy_cache",
    ".pytest_cache",
    // IDEとツール
    ".vs",
    ".idea",
    ".vscode",
];

/// 隠し属性。
const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
/// システム属性。
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
/// reparse point。symlinkとjunctionが該当する。
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

/// 属性による除外の対象（design-decisions.md 6.2）。
const EXCLUDED_ATTRIBUTES: u32 =
    FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM | FILE_ATTRIBUTE_REPARSE_POINT;

/// ディレクトリ1階層を走査する。
///
/// `relative` はワークスペース相対パスであり、ルート自身は空文字で表す。境界の検証は
/// `WorkspaceRoot::resolve` が行う（7.1）。
///
/// 走査できないディレクトリは `ResolveError::Io` を返す。`ErrorCode` への写像は
/// 呼び出し側が行い、`DirectoryNotFound` / `DirectoryAccessDenied` として該当項目へ
/// 表示する。ツリー全体の失敗にはしない（6.2）。
pub fn scan_directory(root: &WorkspaceRoot, relative: &str) -> Result<ScanResult, ResolveError> {
    let absolute = root.resolve(relative)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(&absolute).map_err(ResolveError::Io)? {
        let entry = entry.map_err(ResolveError::Io)?;
        if let Some(node) = to_node(&entry, relative) {
            entries.push(node);
        }
    }
    // フォルダーを先、ファイルを後に置き、それぞれを自然順で並べる。
    entries.sort_by(|left, right| {
        kind_order(left.kind)
            .cmp(&kind_order(right.kind))
            .then_with(|| natural_cmp(&left.name, &right.name))
    });
    Ok(ScanResult {
        path: relative.to_owned(),
        entries,
    })
}

/// 並び順でのフォルダーとファイルの優先度。フォルダーを先に置く。
fn kind_order(kind: FileNodeKind) -> u8 {
    match kind {
        FileNodeKind::Directory => 0,
        FileNodeKind::Markdown => 1,
    }
}

/// ディレクトリの1要素をツリーの要素へ写す。表示対象でなければ `None` を返す。
fn to_node(entry: &fs::DirEntry, parent: &str) -> Option<FileNode> {
    // `DirEntry::metadata` はWindowsでは列挙時に得た情報を返すため、追加のI/Oも
    // 失敗もほぼ起きない。それでも読めなかった要素は落とす。種別も属性も分からず、
    // ツリーへ出す形を決められないためである。
    let metadata = entry.metadata().ok()?;
    if metadata.file_attributes() & EXCLUDED_ATTRIBUTES != 0 {
        return None;
    }
    // 不正なUTF-16を含む名前は落とす。Frontendへ渡すパスは文字列であり、
    // 置換文字へ変換すると、その名前でファイルを開き直せなくなる。
    let name = entry.file_name().to_str()?.to_owned();
    // `WorkspaceRoot::resolve` が拒否する名前は落とす。verbatimパス（`\\?\`）で作られた
    // ファイルは末尾にドットや空白を持つ名前を実際に持ちえて、`read_dir` はその名前を
    // そのまま返す（実測）。ツリーへ出すと、表示されるのに開くと `PathRejected` になる
    // 項目が生じる。走査が返すパスは、そのまま走査と読込へ渡せるものに限る。
    if !is_valid_name(&name) {
        return None;
    }
    if metadata.is_dir() {
        if is_excluded_directory(&name) {
            return None;
        }
        return Some(FileNode {
            path: join_relative(parent, &name),
            has_children: Some(has_visible_child(&entry.path())),
            name,
            kind: FileNodeKind::Directory,
        });
    }
    if !is_markdown_path(&name) {
        return None;
    }
    Some(FileNode {
        path: join_relative(parent, &name),
        name,
        kind: FileNodeKind::Markdown,
        has_children: None,
    })
}

/// フォルダー名が除外対象かを返す。
pub fn is_excluded_directory(name: &str) -> bool {
    EXCLUDED_DIRECTORY_NAMES
        .iter()
        .any(|excluded| excluded.eq_ignore_ascii_case(name))
}

/// ツリーへ表示する子を持つかを返す。
///
/// 展開矢印の有無を決める。対象ファイルを1つも含まないフォルダーも表示するため（6.2）、
/// 子として数えるのは「表示対象のフォルダー」と「対象の拡張子を持つファイル」である。
///
/// 読めなかったときは `true` を返す。展開を試させ、そのときの失敗としてアクセス拒否を
/// 該当項目へ表示するためである（6.2）。`false` を返すと展開矢印が消え、利用者は
/// 中身のない空のフォルダーと区別できない。
///
/// 1000個のサブフォルダーを持つディレクトリで、この判定を含めた走査は最悪43 ms
/// （すべて空のフォルダー、ウォームキャッシュでの実測）であり、ツリー展開の目標
/// 300 ms（[spec.md](../../docs/spec.md) 5.1）の内側に収まる。
fn has_visible_child(directory: &Path) -> bool {
    let Ok(entries) = fs::read_dir(directory) else {
        return true;
    };
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.file_attributes() & EXCLUDED_ATTRIBUTES != 0 {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        // 数える対象を `to_node` が返す対象と一致させる。ここだけ緩いと、展開矢印が
        // 出るのに展開しても空という食い違いが生じる。
        if !is_valid_name(name) {
            continue;
        }
        if metadata.is_dir() {
            if !is_excluded_directory(name) {
                return true;
            }
        } else if is_markdown_path(name) {
            return true;
        }
    }
    false
}

/// 親のワークスペース相対パスと名前をつなぐ。ルート直下は名前そのものになる。
fn join_relative(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}/{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;
    use std::process::Command;

    /// テスト用の一時フォルダー。終了時に削除する。
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("md-peruse-scan-{name}-{}", std::process::id()));
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

    fn set_attribute(path: &Path, attribute: &str) {
        let output = Command::new("cmd")
            .args(["/c", "attrib", attribute])
            .arg(path)
            .output()
            .expect("attribを実行できない");
        assert!(output.status.success(), "属性を設定できない");
    }

    /// verbatimパス（`\\?\`）でファイルを作る。
    ///
    /// Win32のパス正規化が末尾のドットと空白を落とすため、通常のパスではこれらの名前を
    /// 作れない。verbatimパスならば作成でき、`read_dir` はその名前をそのまま返す（実測）。
    /// 区切りはエスケープの取り違えを避けるため文字コードから組み立てる。
    fn write_with_verbatim_path(directory: &Path, name: &str) -> io::Result<()> {
        let separator = char::from(92u8);
        let mut path = std::ffi::OsString::from(format!(
            "{separator}{separator}{}{separator}",
            char::from(63u8)
        ));
        path.push(directory);
        path.push(separator.to_string());
        path.push(name);
        fs::write(std::path::PathBuf::from(path), "# a")
    }

    /// verbatimパスで作ったファイルを消す。通常のパスでは名前が一致せず消せない。
    fn remove_with_verbatim_path(directory: &Path, name: &str) {
        let separator = char::from(92u8);
        let mut path = std::ffi::OsString::from(format!(
            "{separator}{separator}{}{separator}",
            char::from(63u8)
        ));
        path.push(directory);
        path.push(separator.to_string());
        path.push(name);
        let _ = fs::remove_file(std::path::PathBuf::from(path));
    }

    fn names(result: &ScanResult) -> Vec<&str> {
        result
            .entries
            .iter()
            .map(|node| node.name.as_str())
            .collect()
    }

    #[test]
    fn scan_lists_directories_before_markdown_files() {
        let temp = TempDir::new("order");
        for name in ["10-api.md", "2-setup.md", "01-intro.md", "notes.markdown"] {
            fs::write(temp.path().join(name), "# a").unwrap();
        }
        for name in ["zeta", "alpha", "dir10", "dir2"] {
            fs::create_dir_all(temp.path().join(name)).unwrap();
        }
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        let result = scan_directory(&root, "").unwrap();
        assert_eq!(result.path, "");
        assert_eq!(
            names(&result),
            [
                "alpha",
                "dir2",
                "dir10",
                "zeta",
                "01-intro.md",
                "2-setup.md",
                "10-api.md",
                "notes.markdown",
            ]
        );
    }

    #[test]
    fn scan_excludes_noise_and_non_markdown() {
        let temp = TempDir::new("exclude");
        // 除外対象のフォルダー。中身があっても表示しない。
        for name in [".git", "node_modules", "target", ".vscode", "TARGET"] {
            let directory = temp.path().join(name);
            fs::create_dir_all(&directory).unwrap();
            fs::write(directory.join("a.md"), "# a").unwrap();
        }
        // 非Markdownファイルは走査の時点で落とす。
        for name in ["note.txt", "image.png", "a.md.tmp", "md"] {
            fs::write(temp.path().join(name), "x").unwrap();
        }
        fs::write(temp.path().join("keep.md"), "# a").unwrap();
        fs::create_dir_all(temp.path().join("docs")).unwrap();
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        let result = scan_directory(&root, "").unwrap();
        assert_eq!(names(&result), ["docs", "keep.md"]);
    }

    #[test]
    fn scan_excludes_entries_by_attribute() {
        let temp = TempDir::new("attributes");
        fs::write(temp.path().join("hidden.md"), "# a").unwrap();
        fs::write(temp.path().join("system.md"), "# a").unwrap();
        fs::create_dir_all(temp.path().join("hidden-dir")).unwrap();
        fs::write(temp.path().join("visible.md"), "# a").unwrap();
        set_attribute(&temp.path().join("hidden.md"), "+h");
        set_attribute(&temp.path().join("system.md"), "+s");
        set_attribute(&temp.path().join("hidden-dir"), "+h");
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        let result = scan_directory(&root, "").unwrap();
        assert_eq!(names(&result), ["visible.md"]);
    }

    #[test]
    fn scan_excludes_reparse_points() {
        let temp = TempDir::new("reparse");
        let target = temp.path().join("target-dir");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("a.md"), "# a").unwrap();
        fs::write(temp.path().join("keep.md"), "# a").unwrap();
        let output = Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(temp.path().join("link"))
            .arg(&target)
            .output()
            .expect("mklinkを実行できない");
        assert!(output.status.success(), "junctionを作成できない");
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        // symlink、junction、その他のreparse pointは探索しない（6.2）。
        let result = scan_directory(&root, "").unwrap();
        assert_eq!(names(&result), ["target-dir", "keep.md"]);
    }

    #[test]
    fn has_children_reflects_visible_entries() {
        let temp = TempDir::new("has-children");
        // 表示対象を持つ。
        let with_markdown = temp.path().join("with-markdown");
        fs::create_dir_all(&with_markdown).unwrap();
        fs::write(with_markdown.join("a.md"), "# a").unwrap();
        // 対象ファイルを持たないフォルダーも子として数える（6.2）。
        let with_directory = temp.path().join("with-directory");
        fs::create_dir_all(with_directory.join("nested")).unwrap();
        // 空。
        fs::create_dir_all(temp.path().join("empty")).unwrap();
        // 非対象ファイルだけ。
        let with_text = temp.path().join("with-text");
        fs::create_dir_all(&with_text).unwrap();
        fs::write(with_text.join("note.txt"), "x").unwrap();
        // 除外対象のフォルダーだけ。
        let with_noise = temp.path().join("with-noise");
        fs::create_dir_all(with_noise.join("node_modules")).unwrap();
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        let result = scan_directory(&root, "").unwrap();
        let flags: Vec<(&str, Option<bool>)> = result
            .entries
            .iter()
            .map(|node| (node.name.as_str(), node.has_children))
            .collect();
        assert_eq!(
            flags,
            [
                ("empty", Some(false)),
                ("with-directory", Some(true)),
                ("with-markdown", Some(true)),
                ("with-noise", Some(false)),
                ("with-text", Some(false)),
            ]
        );
    }

    #[test]
    fn scan_excludes_names_that_cannot_be_resolved() {
        let temp = TempDir::new("invalid-names");
        // 通常のパスでは作れない名前。verbatimパスなら作成でき、列挙にも現れる。
        let invalid = ["trail.md.", "space.md "];
        for name in invalid {
            write_with_verbatim_path(temp.path(), name).expect("verbatimパスで作成できない");
        }
        fs::write(temp.path().join("keep.md"), "# a").unwrap();
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        // 列挙には現れるが、そのパスで開き直せない。
        let listed: Vec<String> = fs::read_dir(temp.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        for name in invalid {
            assert!(listed.contains(&name.to_owned()), "{name} が列挙に現れない");
            assert!(
                matches!(root.resolve(name), Err(ResolveError::Rejected(_))),
                "{name} が解決できてしまう"
            );
        }

        // 走査は開けない項目をツリーへ出さない。
        let result = scan_directory(&root, "").unwrap();
        assert_eq!(names(&result), ["keep.md"]);

        for name in invalid {
            remove_with_verbatim_path(temp.path(), name);
        }
    }

    #[test]
    fn has_children_ignores_names_that_cannot_be_resolved() {
        let temp = TempDir::new("invalid-child");
        let directory = temp.path().join("only-invalid");
        fs::create_dir_all(&directory).unwrap();
        write_with_verbatim_path(&directory, "trail.md.").expect("verbatimパスで作成できない");
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        // 開けない名前しか持たないフォルダーは、展開しても空になる。展開矢印を出さない。
        let result = scan_directory(&root, "").unwrap();
        assert_eq!(
            result.entries.first().map(|node| node.has_children),
            Some(Some(false))
        );
        assert!(
            scan_directory(&root, "only-invalid")
                .unwrap()
                .entries
                .is_empty(),
            "展開結果と `hasChildren` が食い違う"
        );

        remove_with_verbatim_path(&directory, "trail.md.");
    }

    #[test]
    fn scan_returns_paths_relative_to_the_workspace() {
        let temp = TempDir::new("paths");
        let docs = temp.path().join("docs");
        fs::create_dir_all(docs.join("sub")).unwrap();
        fs::write(docs.join("a.md"), "# a").unwrap();
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        let result = scan_directory(&root, "docs").unwrap();
        assert_eq!(result.path, "docs");
        let paths: Vec<&str> = result
            .entries
            .iter()
            .map(|node| node.path.as_str())
            .collect();
        assert_eq!(paths, ["docs/sub", "docs/a.md"]);
    }

    #[test]
    fn scan_rejects_paths_outside_the_workspace() {
        let temp = TempDir::new("boundary");
        let root_dir = temp.path().join("root");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&root_dir).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.md"), "# secret").unwrap();
        let root = WorkspaceRoot::open(&root_dir).unwrap();

        assert!(matches!(
            scan_directory(&root, "../outside"),
            Err(ResolveError::Rejected(_))
        ));
        assert!(matches!(
            scan_directory(&root, "missing"),
            Err(ResolveError::Io(error)) if error.kind() == io::ErrorKind::NotFound
        ));
    }
}
