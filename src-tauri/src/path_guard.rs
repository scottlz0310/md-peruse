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
use std::path::{Component, Path, PathBuf};

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

    /// ワークスペース相対パスのファイルを開き、開いたhandleの最終パスでも境界内であることを
    /// 確かめる（7.1）。
    ///
    /// `resolve` の検証と実際のオープンの間に、経路上のフォルダーが境界外を指すjunctionへ
    /// 差し替えられる競合がある。開いた後にhandleからパスを引き直せば、読むのが境界内の
    /// ファイルであることを、以後の置換に左右されずに保証できる。
    pub fn open_file(&self, relative: &str) -> Result<fs::File, ResolveError> {
        let absolute = self.resolve(relative)?;
        let file = fs::File::open(&absolute).map_err(ResolveError::Io)?;
        self.ensure_opened_within(&file)?;
        Ok(file)
    }

    fn ensure_opened_within(&self, file: &fs::File) -> Result<(), ResolveError> {
        let opened = final_path(file).map_err(ResolveError::Io)?;
        if !is_within(&self.path, &opened) {
            return Err(PathRejection::Outside.into());
        }
        Ok(())
    }

    /// 絶対パスをワークスペース相対パスへ直す。
    ///
    /// Frontendへ渡す `FileNode.path` などはこの形式である。境界外のパスと実在しない
    /// パスには `None` を返し、ルート自身は空文字を返す。
    ///
    /// 入力は `resolve` と同じく `canonicalize` を通してから判定する。字面のまま
    /// 判定すると、境界外を指すjunctionを経由したパス（`root\to_outside\secret.md`）や
    /// `..` を含むパス（`root\..\outside`）がルート配下に見え、境界外を相対パスとして
    /// 返してしまう。`Path::components` は `..` を解決せずそのまま残すためである。
    ///
    /// 実在しないパスを相対化できないため、削除されたファイルのパスはこの関数では
    /// 扱えない。監視イベント（design-decisions.md 6.4）が運ぶパスは
    /// `relativize_literal` で相対化する。
    pub fn relativize(&self, absolute: &Path) -> Option<String> {
        let absolute = fs::canonicalize(absolute).ok()?;
        if !is_within(&self.path, &absolute) {
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

/// 開いているhandleが指すファイルの最終パスを返す。
///
/// `GetFinalPathNameByHandleW` はjunctionとsymlinkを解決した後のパスを、`canonicalize` と
/// 同じverbatim形式（`\\?\C:\...`、`\\?\UNC\...`）で返す。`std::fs::canonicalize` も内部で
/// 同じAPIを使っており、ルートとの比較で表記が食い違わない。
fn final_path(file: &fs::File) -> io::Result<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{FILE_NAME_NORMALIZED, GetFinalPathNameByHandleW};

    let handle = HANDLE(file.as_raw_handle());
    let mut buffer = vec![0u16; 512];
    loop {
        // SAFETY: `handle` は `file` が所有する有効なhandleであり、この呼び出しの間 `file` は
        // 借用されている。バッファの長さはAPIへスライスとして渡る。
        let length = unsafe { GetFinalPathNameByHandleW(handle, &mut buffer, FILE_NAME_NORMALIZED) }
            as usize;
        if length == 0 {
            return Err(io::Error::last_os_error());
        }
        // 足りないときは終端のNULを含む必要な長さが返る。収まったときは終端を含まない長さが返る。
        if length < buffer.len() {
            buffer.truncate(length);
            return Ok(PathBuf::from(OsString::from_wide(&buffer)));
        }
        buffer.resize(length, 0);
    }
}

/// 監視イベントが運ぶ絶対パスを、スコープのルートからの相対パスへ字面で直す。
///
/// 削除とrename元のパスは、変更が確定した時点で実在しない。`canonicalize` は実在しない
/// パスを解決できないため、`WorkspaceRoot::relativize` ではこれらを扱えない
/// （design-decisions.md 6.4）。ここは字面のまま判定する。
///
/// 字面の判定は `canonicalize` を通す判定より弱く、junctionを経由したパスや `..` を含む
/// パスがルート配下に見える。そのため `..` と `.` を含む入力を拒否したうえで、コンポーネント
/// 単位で境界を判定する。監視イベントのパスは、`canonicalize` 済みのルートを `notify` へ
/// 渡した結果としてOSが返すものであり、Frontendから届く入力とは出所が異なる。7.1が断つのは
/// 境界内から外への逸脱であり、この経路にはそれを作る余地がない。
///
/// 走査（6.2）が落とす名前はここでも落とす。監視が返すパスは、そのまま走査と読込へ渡せる
/// ものに限る。ここだけ緩いと、通知されたのに開けないパスが生じる。
///
/// ルート自身は空文字を返す。境界外と、扱えない名前には `None` を返す。
pub fn relativize_literal(root: &Path, absolute: &Path) -> Option<String> {
    // `Path::components` は `..` を解決せずそのまま残す。字面の前方一致の前に落とす。
    if absolute
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return None;
    }
    if !is_within(root, absolute) {
        return None;
    }
    let mut segments = Vec::new();
    for component in absolute.components().skip(root.components().count()) {
        // 不正なUTF-16を含む名前は落とす。置換文字へ変換すると、その名前でファイルを
        // 開き直せなくなる（走査と同じ扱い）。
        let name = component.as_os_str().to_str()?;
        if !is_valid_name(name) {
            return None;
        }
        segments.push(name);
    }
    Some(segments.join("/"))
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

/// ディレクトリの1要素の名前を、ワークスペース相対パスのセグメントとして使えるかを返す。
///
/// 走査（6.2）が使う。列挙で得た名前をそのまま `FileNode.path` へ組み込むと、`resolve`
/// が拒否する名前を持つ項目がツリーへ出て、表示されるのに開けない状態になる。
///
/// verbatimパス（`\\?\`）で作られたファイルは、末尾にドットや空白を持つ名前を実際に
/// 持ちうる。`read_dir` はその名前をそのまま返し、通常のパスでは開き直せない（実測）。
pub fn is_valid_name(name: &str) -> bool {
    validate_segment(name).is_ok()
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

    /// 開いたhandleの最終パスで境界を確かめる（7.1）。
    ///
    /// `resolve` とオープンの間の差し替えはテストで再現できないため、境界外のファイルを
    /// 開いたhandleを直接渡し、handleの側の判定だけで拒否されることを見る。
    #[test]
    fn opened_files_are_checked_by_their_handle() {
        let temp = TempDir::new("handle");
        let root_dir = temp.path().join("root");
        fs::create_dir_all(root_dir.join("docs")).unwrap();
        fs::write(root_dir.join("docs").join("a.png"), "a").unwrap();
        fs::write(temp.path().join("secret.png"), "secret").unwrap();
        let root = WorkspaceRoot::open(&root_dir).unwrap();

        let file = root
            .open_file("DOCS/A.PNG")
            .expect("境界内のファイルを開けない");
        assert_eq!(
            final_path(&file).unwrap(),
            fs::canonicalize(root_dir.join("docs").join("a.png")).unwrap()
        );

        let outside = fs::File::open(temp.path().join("secret.png")).unwrap();
        assert!(matches!(
            root.ensure_opened_within(&outside),
            Err(ResolveError::Rejected(PathRejection::Outside))
        ));

        // 境界外を指すjunctionを経由した場合も、handleは解決先を指す。
        create_junction(&root_dir.join("to_outside"), temp.path());
        let via_junction = fs::File::open(root_dir.join("to_outside").join("secret.png")).unwrap();
        assert!(matches!(
            root.ensure_opened_within(&via_junction),
            Err(ResolveError::Rejected(PathRejection::Outside))
        ));
    }

    /// 260文字を超える最終パスでも取得できる。初期バッファ（512）より長い場合を含む。
    #[test]
    fn final_paths_longer_than_the_initial_buffer_are_returned() {
        let temp = TempDir::new("final-long");
        let mut directory = temp.path().to_owned();
        for _ in 0..10 {
            directory.push("n".repeat(60));
        }
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("a.png");
        fs::write(&path, "a").unwrap();

        let resolved = final_path(&fs::File::open(&path).unwrap()).unwrap();
        assert!(
            resolved.as_os_str().len() > 512,
            "テストの前提を満たしていない"
        );
        assert_eq!(resolved, fs::canonicalize(&path).unwrap());
    }

    #[test]
    fn relativize_returns_none_outside_the_workspace() {
        let temp = TempDir::new("relativize");
        let root_dir = temp.path().join("root");
        let outside = temp.path().join("outside");
        fs::create_dir_all(root_dir.join("docs")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(temp.path().join("rootx")).unwrap();
        fs::write(root_dir.join("docs").join("a.md"), "# a").unwrap();
        fs::write(outside.join("secret.md"), "# secret").unwrap();
        create_junction(&root_dir.join("to_outside"), &outside);
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

        // 字面のまま判定すると、いずれもルート配下に見えてしまう。
        assert_eq!(
            root.relativize(&root.path().join("to_outside").join("secret.md")),
            None
        );
        assert_eq!(root.relativize(&root.path().join("to_outside")), None);
        assert_eq!(
            root.relativize(&root.path().join("..").join("outside")),
            None
        );
        assert_eq!(root.relativize(&root.path().join("..").join("rootx")), None);

        // 実在しないパスは相対化できない。
        assert_eq!(root.relativize(&root.path().join("missing.md")), None);
    }

    /// 監視イベント用の字面の相対化（design-decisions.md 6.4）。
    ///
    /// 実ファイルを作らないのは、この関数がファイルシステムへ問い合わせないためである。
    /// 削除が確定したパスを扱えることが存在理由であり、実在を前提にすると検証にならない。
    #[test]
    fn relativize_literal_handles_paths_that_no_longer_exist() {
        let root = Path::new(r"C:\root");
        let cases = [
            ("ルート自身は空文字", root.to_path_buf(), Some("")),
            (
                "実在しない削除済みのパスも相対化できる",
                root.join("docs").join("gone.md"),
                Some("docs/gone.md"),
            ),
            ("ルート直下", root.join("a.md"), Some("a.md")),
            // コンポーネント単位で判定する。前方一致では `C:\rootx` を配下と誤判定する。
            (
                "隣接する名前は配下ではない",
                PathBuf::from(r"C:\rootx\a.md"),
                None,
            ),
            ("境界外", PathBuf::from(r"C:\other\a.md"), None),
            // `Path::components` は `..` を解決しない。字面の判定の前に落とす。
            (
                "親参照を含むパスは拒否する",
                root.join("..").join("outside").join("a.md"),
                None,
            ),
            // 走査が落とす名前はここでも落とす。通知されたのに開けないパスを作らない。
            ("末尾のドットを持つ名前は拒否する", root.join("a.md."), None),
            (
                "代替データストリーム表記は拒否する",
                root.join("a.md:stream"),
                None,
            ),
        ];
        for (name, absolute, expected) in cases {
            assert_eq!(
                relativize_literal(root, &absolute).as_deref(),
                expected,
                "{name}: {}",
                absolute.display()
            );
        }
    }

    /// 大文字小文字の差はルートの表記と対象の表記の双方で吸収する。
    ///
    /// `notify` が返すパスの表記は、監視へ渡したルートの表記に従う。ルートは
    /// `canonicalize` 済みだが、判定を表記の一致へ依存させない（7.1）。
    #[test]
    fn relativize_literal_ignores_case_in_the_root() {
        assert_eq!(
            relativize_literal(Path::new(r"C:\Root"), Path::new(r"C:\root\docs\a.md")).as_deref(),
            Some("docs/a.md")
        );
    }
}
