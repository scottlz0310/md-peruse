//! ファイルの読込（design-decisions.md 6.3、7.1）。
//!
//! 読み込むのはワークスペース境界の内側にあるファイルに限る。境界の検証は
//! `WorkspaceRoot::resolve` が行い、ここが担うのはサイズ上限の判定、文字コードの判定、
//! 改行の正規化である。
//!
//! 文字コードはBOMで判定できるものだけを扱い、CP932などの推測変換は行わない（6.3）。
//! 推測が外れると、文字化けした本文を「読めた」として表示することになる。原因を示して
//! 保存し直させるほうが確実である。
//!
//! 共有モードは標準ライブラリの既定をそのまま使い、`OpenOptions` で絞らない。既定は
//! `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE` であり、閲覧専用の
//! ビューワーが開いている間にエディタが保存できなくなる事態が起きない。逆に、他の
//! プロセスが共有を許さずに開いているファイルは読めない。このときの
//! `ERROR_SHARING_VIOLATION` は `FileLocked` へ写し、自動リトライは行わない（12章）。
//! atomic replace直後の再読込だけは例外だが、その判断は監視側（6.5）が持つ。ここは
//! 1回の読込を行うだけである。
//!
//! 260文字を超えるパスは特別扱いしない。標準ライブラリは絶対パスをverbatimパス
//! （`\\?\`）へ変換してからWin32 APIを呼ぶため、`MAX_PATH` の制限を受けない。
//! `WorkspaceRoot` が保持するルートは `canonicalize` を通したverbatimパスであり、
//! そこから組み立てる対象のパスも同じ形式になる。マニフェストの長パス対応
//! （`longPathAware`）も要らない（実測。`long_paths_are_readable` で固定）。

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use crate::ipc::types::{FileContent, TextEncoding};
use crate::limits::MAX_MARKDOWN_BYTES;
use crate::path_guard::{ResolveError, WorkspaceRoot};

/// UTF-8のBOM。
const UTF8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
/// UTF-16 LEのBOM。
const UTF16_LE_BOM: [u8; 2] = [0xFF, 0xFE];
/// UTF-16 BEのBOM。
const UTF16_BE_BOM: [u8; 2] = [0xFE, 0xFF];

/// `ERROR_SHARING_VIOLATION`。他のプロセスが共有を許さずに開いている。
const ERROR_SHARING_VIOLATION: i32 = 32;
/// `ERROR_LOCK_VIOLATION`。対象の範囲がロックされている。
const ERROR_LOCK_VIOLATION: i32 = 33;

/// ファイル読込の失敗。
///
/// `ErrorCode` への写像はcommand層で行う。同じ「見つからない」でも対象がディレクトリか
/// ファイルかで `code` が異なり、区別できるのは対象の種別を知る呼び出し側だけである
/// （design-decisions.md 5.3）。
#[derive(Debug)]
pub enum ReadError {
    /// パスの解決、またはファイルのオープンと読み取りで生じた失敗。
    Resolve(ResolveError),
    /// 上限（10 MiB）を超えている。
    TooLarge,
    /// 文字コードを判定できない、またはデコードに失敗した。
    Decode,
}

impl From<ResolveError> for ReadError {
    fn from(error: ResolveError) -> Self {
        Self::Resolve(error)
    }
}

/// ワークスペース内のファイルを1件読み込む。
///
/// `relative` はワークスペース相対パスであり、境界の検証は `WorkspaceRoot::resolve` が
/// 行う（7.1）。返す `FileContent.path` は要求と同じ相対パスであり、ネイティブ絶対パスは
/// 含めない。
pub fn read_file(root: &WorkspaceRoot, relative: &str) -> Result<FileContent, ReadError> {
    let absolute = root.resolve(relative)?;
    let bytes = read_bytes(&absolute)?;
    // 上限の判定を通っているため `u32` へ収まる。
    let byte_size = u32::try_from(bytes.len()).expect("上限を超えたバイト列が読込を通った");
    let (text, encoding) = decode(&bytes)?;
    Ok(FileContent {
        path: relative.to_owned(),
        text: normalize_newlines(text),
        encoding,
        byte_size,
    })
}

/// ファイルの内容をバイト列として読む。上限を超えていれば読み切らずに失敗させる。
fn read_bytes(path: &Path) -> Result<Vec<u8>, ReadError> {
    let file = File::open(path).map_err(io_error)?;
    let declared = file.metadata().map_err(io_error)?.len();
    if declared > u64::from(MAX_MARKDOWN_BYTES) {
        return Err(ReadError::TooLarge);
    }
    let mut bytes = Vec::with_capacity(usize::try_from(declared).unwrap_or_default());
    // オープンから読み取りまでの間に書き足された場合に備え、上限を1バイト超えるところまで
    // 読んで超過を検出する。`metadata` の値だけを信じると、上限を超えた本文を通す。
    file.take(u64::from(MAX_MARKDOWN_BYTES) + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() > MAX_MARKDOWN_BYTES as usize {
        return Err(ReadError::TooLarge);
    }
    Ok(bytes)
}

fn io_error(error: io::Error) -> ReadError {
    ReadError::Resolve(ResolveError::Io(error))
}

/// 共有違反かどうかを返す。
///
/// `io::ErrorKind` はこれらを `Uncategorized` として扱い区別できないため、OSのコードで
/// 判定する。atomic replaceの最中に読み込むと起こりうる（6.5）。
pub fn is_sharing_violation(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION)
    )
}

/// BOMで文字コードを判定し、本文をデコードする（6.3）。
///
/// BOMを持たないファイルはUTF-8として検証する。判定できない並びを別の文字コードとして
/// 読み替えることはしない。
fn decode(bytes: &[u8]) -> Result<(String, TextEncoding), ReadError> {
    if let Some(body) = bytes.strip_prefix(&UTF8_BOM) {
        return Ok((decode_utf8(body)?, TextEncoding::Utf8Bom));
    }
    if let Some(body) = bytes.strip_prefix(&UTF16_LE_BOM) {
        return Ok((
            decode_utf16(body, u16::from_le_bytes)?,
            TextEncoding::Utf16Le,
        ));
    }
    if let Some(body) = bytes.strip_prefix(&UTF16_BE_BOM) {
        return Ok((
            decode_utf16(body, u16::from_be_bytes)?,
            TextEncoding::Utf16Be,
        ));
    }
    Ok((decode_utf8(bytes)?, TextEncoding::Utf8))
}

fn decode_utf8(bytes: &[u8]) -> Result<String, ReadError> {
    String::from_utf8(bytes.to_vec()).map_err(|_| ReadError::Decode)
}

/// UTF-16のバイト列をデコードする。バイト順はBOMで決まり、呼び出し側が渡す。
///
/// 奇数バイトで終わる並びと、対にならないサロゲートは失敗とする。置換文字へ倒すと、
/// 壊れたファイルを「読めた」として表示することになる。
fn decode_utf16(bytes: &[u8], to_unit: fn([u8; 2]) -> u16) -> Result<String, ReadError> {
    if bytes.len() % 2 != 0 {
        return Err(ReadError::Decode);
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| to_unit([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&units).map_err(|_| ReadError::Decode)
}

/// 改行をLFへ揃える（6.3）。CRLFとCR単独の両方を対象とする。
///
/// CRを含まない場合は入力をそのまま返す。上限が10 MiBあるため、変換の要否によらず全体を
/// 作り直すと無駄が大きい。
fn normalize_newlines(text: String) -> String {
    if !text.contains('\r') {
        return text;
    }
    let mut normalized = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\r' {
            // CRLFは1つのLFへ畳む。続かないCRもLFへ直す。
            characters.next_if_eq(&'\n');
            normalized.push('\n');
        } else {
            normalized.push(character);
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::path_guard::PathRejection;
    use std::fs;
    use std::os::windows::fs::OpenOptionsExt;

    /// テスト用の一時フォルダー。終了時に削除する。
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("md-peruse-read-{name}-{}", std::process::id()));
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

    /// BOMと本文をつないだバイト列を作る。
    fn with_bom(bom: &[u8], body: &[u8]) -> Vec<u8> {
        let mut bytes = bom.to_vec();
        bytes.extend_from_slice(body);
        bytes
    }

    /// UTF-16のバイト列を作る。`little_endian` がバイト順を決める。
    fn utf16(text: &str, little_endian: bool) -> Vec<u8> {
        let bom = if little_endian {
            UTF16_LE_BOM
        } else {
            UTF16_BE_BOM
        };
        let mut bytes = bom.to_vec();
        for unit in text.encode_utf16() {
            if little_endian {
                bytes.extend_from_slice(&unit.to_le_bytes());
            } else {
                bytes.extend_from_slice(&unit.to_be_bytes());
            }
        }
        bytes
    }

    #[test]
    fn encodings_are_detected_by_bom() {
        // サロゲートペア（絵文字）を含め、UTF-16の2ユニット表現も復元できることを見る。
        let text = "# 見出し\n本文 🎈";
        let cases = [
            (text.as_bytes().to_vec(), TextEncoding::Utf8),
            (with_bom(&UTF8_BOM, text.as_bytes()), TextEncoding::Utf8Bom),
            (utf16(text, true), TextEncoding::Utf16Le),
            (utf16(text, false), TextEncoding::Utf16Be),
        ];
        for (bytes, expected) in cases {
            let (decoded, encoding) = decode(&bytes).expect("デコードできない");
            assert_eq!(encoding, expected);
            assert_eq!(decoded, text, "{expected:?}");
        }
    }

    #[test]
    fn an_empty_file_decodes_as_utf8() {
        // BOMを持たない0バイトのファイル。判定できる材料がないため既定のUTF-8とする。
        assert_eq!(decode(&[]).unwrap(), (String::new(), TextEncoding::Utf8));
        // BOMだけのファイルは、BOMどおりの文字コードで本文が空になる。
        assert_eq!(
            decode(&UTF8_BOM).unwrap(),
            (String::new(), TextEncoding::Utf8Bom)
        );
        assert_eq!(
            decode(&UTF16_LE_BOM).unwrap(),
            (String::new(), TextEncoding::Utf16Le)
        );
    }

    #[test]
    fn undecodable_bytes_are_rejected() {
        let cases = [
            ("不正なUTF-8のバイト列", vec![0x41, 0xC3, 0x28]),
            // CP932の「あ」。推測変換を行わないため、UTF-8として不正なら失敗する（6.3）。
            ("CP932の本文", vec![0x82, 0xA0]),
            (
                "奇数バイトで終わるUTF-16 LE",
                with_bom(&UTF16_LE_BOM, &[0x41, 0x00, 0x42]),
            ),
            (
                "対にならないサロゲート",
                with_bom(&UTF16_LE_BOM, &[0x00, 0xD8]),
            ),
        ];
        for (label, bytes) in cases {
            assert!(
                matches!(decode(&bytes), Err(ReadError::Decode)),
                "{label} を受け入れている"
            );
        }
    }

    #[test]
    fn newlines_are_normalized_to_lf() {
        let cases = [
            ("a\nb", "a\nb"),
            ("a\r\nb", "a\nb"),
            ("a\rb", "a\nb"),
            // CRが続く場合もCRLFだけを1つへ畳む。空行を失わない。
            ("a\r\r\nb", "a\n\nb"),
            ("a\r\n\rb\n", "a\n\nb\n"),
            ("末尾のCR\r", "末尾のCR\n"),
            ("", ""),
        ];
        for (input, expected) in cases {
            assert_eq!(
                normalize_newlines(input.to_owned()),
                expected,
                "入力: {input:?}"
            );
        }
    }

    #[test]
    fn a_file_in_the_workspace_is_read() {
        let temp = TempDir::new("basic");
        let text = "# 見出し\r\n本文\r\n";
        let bytes = with_bom(&UTF8_BOM, text.as_bytes());
        fs::write(temp.path().join("a.md"), &bytes).unwrap();
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        let content = read_file(&root, "a.md").unwrap();
        // 応答が持つのは要求と同じ相対パスであり、ネイティブ絶対パスを含めない（7.1）。
        assert_eq!(content.path, "a.md");
        assert_eq!(content.text, "# 見出し\n本文\n");
        assert_eq!(content.encoding, TextEncoding::Utf8Bom);
        // `byte_size` はファイルのバイト数である。BOMを含み、改行の正規化より前の値を返す。
        assert_eq!(content.byte_size, u32::try_from(bytes.len()).unwrap());
    }

    #[test]
    fn the_size_limit_is_enforced_at_the_boundary() {
        let temp = TempDir::new("limit");
        let root = WorkspaceRoot::open(temp.path()).unwrap();
        let limit = MAX_MARKDOWN_BYTES as usize;

        fs::write(temp.path().join("at.md"), vec![b'a'; limit]).unwrap();
        assert_eq!(
            read_file(&root, "at.md").unwrap().byte_size,
            MAX_MARKDOWN_BYTES
        );

        fs::write(temp.path().join("over.md"), vec![b'a'; limit + 1]).unwrap();
        assert!(matches!(
            read_file(&root, "over.md"),
            Err(ReadError::TooLarge)
        ));
    }

    #[test]
    fn paths_outside_the_workspace_are_rejected() {
        let temp = TempDir::new("outside");
        let root_directory = temp.path().join("root");
        fs::create_dir_all(&root_directory).unwrap();
        fs::write(temp.path().join("secret.md"), "# secret").unwrap();
        let root = WorkspaceRoot::open(&root_directory).unwrap();

        // 形式で落ちるもの。境界の判定まで進ませない（7.1）。
        let malformed = [
            "../secret.md",
            r"..\secret.md",
            "C:/secret.md",
            "a.md:stream",
        ];
        for relative in malformed {
            assert!(
                matches!(
                    read_file(&root, relative),
                    Err(ReadError::Resolve(ResolveError::Rejected(
                        PathRejection::Malformed
                    )))
                ),
                "受け入れている: {relative}"
            );
        }

        let error = read_file(&root, "missing.md").unwrap_err();
        assert!(
            matches!(&error, ReadError::Resolve(ResolveError::Io(cause)) if cause.kind() == io::ErrorKind::NotFound),
            "{error:?}"
        );
    }

    #[test]
    fn long_paths_are_readable() {
        let temp = TempDir::new("longpath");
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        // MAX_PATH（260文字）を超える対象を作る。標準ライブラリが絶対パスをverbatimパスへ
        // 変換するため、マニフェストの長パス対応がなくても扱える。
        let segment = "n".repeat(60);
        let mut directory = temp.path().to_owned();
        let mut relative = String::new();
        for _ in 0..5 {
            directory.push(&segment);
            relative.push_str(&segment);
            relative.push('/');
        }
        fs::create_dir_all(&directory).expect("深い階層を作成できない");
        let file = directory.join("long.md");
        fs::write(&file, "# 長いパス").expect("長いパスへ書き込めない");
        relative.push_str("long.md");
        assert!(
            file.as_os_str().len() > 260,
            "テストの前提を満たしていない: {} 文字",
            file.as_os_str().len()
        );

        let content = read_file(&root, &relative).expect("長いパスを読めない");
        assert_eq!(content.text, "# 長いパス");
        assert_eq!(content.path, relative);
    }

    #[test]
    fn a_file_opened_without_sharing_is_reported_as_a_sharing_violation() {
        let temp = TempDir::new("locked");
        let path = temp.path().join("a.md");
        fs::write(&path, "# a").unwrap();
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        let _exclusive = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .expect("共有を許さずに開けない");

        let error = read_file(&root, "a.md").unwrap_err();
        let ReadError::Resolve(ResolveError::Io(cause)) = &error else {
            panic!("共有違反が別の失敗になっている: {error:?}");
        };
        assert!(is_sharing_violation(cause), "{cause:?}");
    }

    #[test]
    fn a_file_held_open_by_a_writer_is_still_readable() {
        // 読込側が共有を絞らないことの裏返しとして、エディタが開いたままのファイルも読める。
        // 読込側で絞ると、閲覧している間はエディタが保存できなくなる。
        let temp = TempDir::new("shared");
        let path = temp.path().join("a.md");
        fs::write(&path, "# a").unwrap();
        let root = WorkspaceRoot::open(temp.path()).unwrap();

        let _writer = fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("書込みで開けない");

        assert_eq!(read_file(&root, "a.md").unwrap().text, "# a");
    }
}
