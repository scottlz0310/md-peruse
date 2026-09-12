//! Markdownに書かれた画像参照を、ワークスペース相対パスへ解決する（design-decisions.md 7.3）。
//!
//! 解決するのはワークスペース内の相対画像だけである。リモート画像、`data:` 画像、UNC表記、
//! device path、ワークスペース外はいずれも遮断する（7.3）。
//!
//! 解決はFrontendではなくRust側で行う。Frontendは参照文字列をそのまま渡し（`ImageResourceRequest`）、
//! 受け取るのはresource IDである。ネイティブ絶対パスをFrontendへ渡さない方針（7.1）の下では、
//! 相対リンクの基点も境界の判定もRust側にしか置けない。
//!
//! 規則はリンクの解決（`src/markdown/link-target.ts`）と揃える。セグメント単位の復号、
//! ルート基準表記（`/docs/a.png`）、`.` と `..` の扱い、クエリと断片の切り落としまで同じで
//! ある。同じ文書に書かれた `[a](b.md)` と `![a](b.png)` が違う規則で解決されると、
//! 書き手から見た振る舞いが説明できない。異なるのは、対象の拡張子を見ない点だけである。
//! 画像の形式は拡張子ではなく内容で判定する（7.3、`super::format`）。

use crate::path_guard::{PathRejection, is_valid_name, validate_relative_path};

/// 画像参照をワークスペース相対パスへ解決する。
///
/// `document_path` は参照を含む文書のワークスペース相対パスであり、相対参照の基点となる。
/// 返すのは区切りを `/` としたワークスペース相対パスで、実在と境界の最終判定は
/// `WorkspaceRoot::resolve` が行う（7.1）。
pub fn resolve(document_path: &str, reference: &str) -> Result<String, PathRejection> {
    if is_remote(reference) {
        return Err(PathRejection::Malformed);
    }
    // 基点そのものが受け付けられない形式なら、解決した結果も受け付けられない。ここで
    // 落とすことで、この関数が返すのは常にワークスペース相対パスの形式を満たすものになる。
    let document_segments = validate_relative_path(document_path)?;
    let path = strip_query_and_fragment(reference);
    if path.is_empty() {
        return Err(PathRejection::Malformed);
    }

    // ルート基準表記は文書の位置を基点にしない。
    let mut segments: Vec<String> = if path.starts_with('/') {
        Vec::new()
    } else {
        // 文書があるディレクトリを基点にする。
        document_segments
            .iter()
            .take(document_segments.len().saturating_sub(1))
            .map(|segment| (*segment).to_owned())
            .collect()
    };
    for segment in path.split('/') {
        // 先頭・末尾・連続する区切りから生じる空のセグメントは読み飛ばす。
        if segment.is_empty() {
            continue;
        }
        let decoded = decode_segment(segment).ok_or(PathRejection::Malformed)?;
        if decoded == "." {
            continue;
        }
        if decoded == ".." {
            // ルートを越える参照は境界外を指す。ワークスペース外の画像は表示しない（7.3）。
            segments.pop().ok_or(PathRejection::Outside)?;
            continue;
        }
        // 区切りは復号の前に分けてある。復号して現れた `/` と `\` は、区切りをエンコードで
        // 隠したトラバーサルであり、セグメントの名前としては受け付けない（7.2）。
        if decoded.contains(['/', '\\']) || !is_valid_name(&decoded) {
            return Err(PathRejection::Malformed);
        }
        segments.push(decoded);
    }

    if segments.is_empty() {
        return Err(PathRejection::Malformed);
    }
    Ok(segments.join("/"))
}

/// 参照がワークスペース外の取得元を指すかを返す。
///
/// `http:` と `https:` はsanitize schemaを通る唯一のスキームであり（8.2）、ここへ届く。
/// スキーム相対URL（`//host/share`）はUNCパスにも見えるため同じ扱いとする。それ以外の
/// スキーム（`data:`、`file:`）は、セグメントが `:` を含むことで名前の検証に落ちる。
fn is_remote(reference: &str) -> bool {
    let lowercase = reference.to_ascii_lowercase();
    lowercase.starts_with("//")
        || lowercase.starts_with("http://")
        || lowercase.starts_with("https://")
}

/// クエリと断片を切り落とす。
///
/// ファイルシステムにクエリの概念はなく、`?` も `#` もWindowsのファイル名には使えない。
/// 断片を落とすのは、配信するのがファイル全体であり、SVGのビュー指定のような断片を
/// Rust側が解釈しないためである。
fn strip_query_and_fragment(reference: &str) -> &str {
    let before_hash = reference.split('#').next().unwrap_or(reference);
    before_hash.split('?').next().unwrap_or(before_hash)
}

/// パーセントエンコードを1回だけ復号する。
///
/// 復号はセグメントへ分けたあとに行う。パス全体を一括で復号すると、`..%2F..%2Fsecret.png`
/// のように区切りをエンコードで隠したトラバーサルが成立する（design-decisions.md 7.2）。
/// 復号結果がUTF-8にならない入力は受け付けない。
fn decode_segment(segment: &str) -> Option<String> {
    let bytes = segment.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let digits = segment.get(index + 1..index + 3)?;
            // `u8::from_str_radix` は符号を受け付けるため、16進2桁であることを先に確かめる。
            // 確かめないと `%+1` のような並びが復号できてしまう。
            if !digits.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return None;
            }
            decoded.push(u8::from_str_radix(digits, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 相対参照は文書のあるディレクトリを基点に解決する。
    #[test]
    fn relative_references_resolve_against_the_document() {
        let cases = [
            ("a.md", "img.png", "img.png"),
            ("a.md", "./img.png", "img.png"),
            ("docs/a.md", "img.png", "docs/img.png"),
            ("docs/a.md", "sub/img.png", "docs/sub/img.png"),
            ("docs/sub/a.md", "../img.png", "docs/img.png"),
            ("docs/sub/a.md", "../../img.png", "img.png"),
            ("docs/a.md", "./sub/./img.png", "docs/sub/img.png"),
            // 復号したセグメントを名前として使う。
            ("docs/a.md", "my%20img.png", "docs/my img.png"),
            ("docs/a.md", "%E5%9B%B3.png", "docs/図.png"),
        ];
        for (document, reference, expected) in cases {
            assert_eq!(
                resolve(document, reference).as_deref(),
                Ok(expected),
                "{document} の {reference}"
            );
        }
    }

    /// ルート基準表記は文書の位置を基点にしない（7.2）。
    #[test]
    fn root_relative_references_ignore_the_document_location() {
        let cases = [
            ("docs/sub/a.md", "/img.png", "img.png"),
            ("docs/sub/a.md", "/assets/img.png", "assets/img.png"),
        ];
        for (document, reference, expected) in cases {
            assert_eq!(
                resolve(document, reference).as_deref(),
                Ok(expected),
                "{document} の {reference}"
            );
        }
    }

    /// ルートを越える参照は境界外として拒否する（7.3）。
    ///
    /// `PathRejected` ではなく `PathOutsideWorkspace` へ写す区分を保つため、理由を
    /// 形式の誤りと分ける。
    #[test]
    fn references_that_leave_the_workspace_are_rejected() {
        let cases = [
            ("a.md", "../img.png"),
            ("docs/a.md", "../../img.png"),
            ("docs/sub/a.md", "../../../img.png"),
            // ルート基準表記でも越えられない。
            ("docs/a.md", "/../img.png"),
        ];
        for (document, reference) in cases {
            assert_eq!(
                resolve(document, reference),
                Err(PathRejection::Outside),
                "{document} の {reference}"
            );
        }
    }

    /// ワークスペース外から取得する参照は解決しない（7.3）。
    #[test]
    fn references_outside_the_workspace_are_rejected() {
        let cases = [
            "http://example.com/img.png",
            "https://example.com/img.png",
            "HTTPS://example.com/img.png",
            "//example.com/img.png",
            "data:image/png;base64,iVBORw0KGgo=",
            "file:///C:/img.png",
            r"C:\img.png",
            r"\\server\share\img.png",
            r"\\?\C:\img.png",
        ];
        for reference in cases {
            assert_eq!(
                resolve("docs/a.md", reference),
                Err(PathRejection::Malformed),
                "{reference}"
            );
        }
    }

    /// エンコードで区切りを隠したトラバーサルは成立しない（7.2）。
    ///
    /// 復号はセグメントへ分けたあとに1回だけ行うため、復号して現れた `/` と `\` は
    /// 区切りにならない。
    #[test]
    fn encoded_separators_do_not_become_separators() {
        let cases = [
            "..%2F..%2Fsecret.png",
            "..%5C..%5Csecret.png",
            // ルートまで戻ってから隠した区切りで出ようとする形。
            "../..%2Fsecret.png",
            "sub%2Fimg.png",
            "%2e%2e%2fsecret.png",
        ];
        for reference in cases {
            assert_eq!(
                resolve("docs/a.md", reference),
                Err(PathRejection::Malformed),
                "{reference}"
            );
        }
    }

    /// 名前として使えないセグメントを持つ参照は拒否する（7.1）。
    #[test]
    fn references_with_unusable_names_are_rejected() {
        let cases = [
            "img.png:stream",
            "img.png.",
            "img.png ",
            "sub/*.png",
            "img\u{0}.png",
            "",
            "/",
            "#fragment",
        ];
        for reference in cases {
            assert_eq!(
                resolve("docs/a.md", reference),
                Err(PathRejection::Malformed),
                "{reference}"
            );
        }
    }

    /// 復号できない参照は拒否する。推測で読み替えない。
    #[test]
    fn malformed_encoding_is_rejected() {
        let cases = [
            "img%zz.png",
            "img%2.png",
            "img%.png",
            // 符号を16進2桁として読まない。
            "img%+1.png",
            // 復号結果がUTF-8にならない。
            "img%FF.png",
        ];
        for reference in cases {
            assert_eq!(
                resolve("docs/a.md", reference),
                Err(PathRejection::Malformed),
                "{reference}"
            );
        }
    }

    /// クエリと断片は落とす。リンクの解決（`link-target.ts`）と同じ扱いである。
    #[test]
    fn the_query_and_fragment_are_dropped() {
        let cases = [
            ("img.png?v=2", "docs/img.png"),
            ("img.png#view", "docs/img.png"),
            ("img.png?v=2#view", "docs/img.png"),
        ];
        for (reference, expected) in cases {
            assert_eq!(
                resolve("docs/a.md", reference).as_deref(),
                Ok(expected),
                "{reference}"
            );
        }
    }

    /// 基点が受け付けられない形式なら解決しない。
    ///
    /// `document_path` もFrontendから届く値であり、これを検証しないと、解決した結果が
    /// ワークスペース相対パスの形式を満たさないまま後段へ渡る。
    #[test]
    fn a_malformed_document_path_is_rejected() {
        let cases = [
            r"C:\docs\a.md",
            r"\\server\share\a.md",
            "../a.md",
            "docs/./a.md",
            "a.md:stream",
        ];
        for document in cases {
            assert_eq!(
                resolve(document, "img.png"),
                Err(PathRejection::Malformed),
                "{document}"
            );
        }
    }
}
