//! 画像の形式判定と処理上限の検証（design-decisions.md 7.3）。
//!
//! 形式は拡張子ではなく内容で判定する。拡張子で判定すると、`a.png` という名前の
//! 別形式を許可形式として配信することになり、`Content-Type` が実体と食い違う。
//!
//! 判定はresource IDの発行時と配信時の両方で行う（5.4）。検証と配信の間に対象が
//! 置換される競合があるため、発行時に一度通しただけでは配信するバイト列の形式を
//! 保証できない。どちらも同じ入口を通す。
//!
//! 寸法の取得は `imagesize` に委ねる。デコーダーを持つcrate（`image` など）を使わないのは、
//! 上限の判定に必要なのはヘッダーが宣言する寸法だけであり、デコードすると上限で防ごうと
//! しているメモリをその場で確保してしまうためである。許可形式のうちラスタの6種（PNG、
//! JPEG、GIF、WebP、AVIF、BMP）が内容から判定でき、AVIFはHEICと区別して取れることを
//! 実測で確認した（`ImageType::Heif(Compression::Av1)`）。

use imagesize::{Compression, ImageType};

use crate::ipc::error::ErrorCode;
use crate::limits::{MAX_IMAGE_BYTES, MAX_IMAGE_EDGE_PIXELS, MAX_IMAGE_TOTAL_PIXELS};

/// 表示を許可する画像形式（design-decisions.md 7.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Gif,
    Webp,
    Avif,
    Bmp,
    /// ローカルSVG。`img` の画像リソースとしてだけ提供する（7.4）。
    Svg,
}

impl ImageFormat {
    /// custom protocolの応答へ載せる `Content-Type`。
    ///
    /// 判定した形式から引くため、拡張子と実体が食い違っていても実体に従う（7.3）。
    pub fn content_type(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
            Self::Avif => "image/avif",
            Self::Bmp => "image/bmp",
            Self::Svg => "image/svg+xml",
        }
    }
}

/// 画像を受け入れられない理由。
///
/// 発行時は `IpcError` の `code` として、配信時はHTTPのステータスコードとして表す。
/// 区分を両者で共有するため、写像ではなくこの列挙をそのまま返す（design-decisions.md 5.4）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageRejection {
    /// 許可形式（PNG、JPEG、GIF、WebP、AVIF、BMP、SVG）ではない。
    UnsupportedFormat,
    /// 1画像の上限（32 MiB）を超えている。
    TooLarge,
    /// ピクセル寸法の上限を超えている。
    PixelLimitExceeded,
    /// 許可形式と判定できたが、ヘッダーから寸法を取れない。
    Decode,
}

impl ImageRejection {
    /// 対応する `ErrorCode`。
    pub fn code(self) -> ErrorCode {
        match self {
            Self::UnsupportedFormat => ErrorCode::ImageUnsupportedFormat,
            Self::TooLarge => ErrorCode::ImageTooLarge,
            Self::PixelLimitExceeded => ErrorCode::ImagePixelLimitExceeded,
            Self::Decode => ErrorCode::ImageDecodeFailed,
        }
    }
}

/// 画像のバイト列を検証し、判定した形式を返す。
///
/// 検査の順はバイト数、形式、ピクセル寸法とする。バイト数を先に見るのは、上限を超えた
/// 入力に対して形式の判定を走らせないためである。
pub fn validate(bytes: &[u8]) -> Result<ImageFormat, ImageRejection> {
    if bytes.len() > MAX_IMAGE_BYTES as usize {
        return Err(ImageRejection::TooLarge);
    }
    let format = detect(bytes)?;
    // SVGはピクセル寸法の上限の対象外とする。ベクター形式であり、`width` と `height` は
    // 省略も単位付きも割合指定もでき、宣言された値がラスタライズの大きさを決めるとは
    // 限らない。属性を読んでも判定できるのは一部に限られ、抜けのある判定を持つより
    // バイト数の上限だけで守るほうが規則として一貫する。
    if format == ImageFormat::Svg {
        return Ok(format);
    }
    let size = imagesize::blob_size(bytes).map_err(|_| ImageRejection::Decode)?;
    if size.width > MAX_IMAGE_EDGE_PIXELS as usize || size.height > MAX_IMAGE_EDGE_PIXELS as usize {
        return Err(ImageRejection::PixelLimitExceeded);
    }
    if size.width * size.height > MAX_IMAGE_TOTAL_PIXELS as usize {
        return Err(ImageRejection::PixelLimitExceeded);
    }
    Ok(format)
}

/// バイト列の内容から形式を判定する。
///
/// `imagesize` が扱わないSVGだけを自前で判定する。`imagesize` の機能は許可形式のものに
/// 絞ってあるため、ICOやTIFFなど許可していない形式はここで `UnsupportedFormat` になる。
fn detect(bytes: &[u8]) -> Result<ImageFormat, ImageRejection> {
    match imagesize::image_type(bytes) {
        Ok(ImageType::Png) => Ok(ImageFormat::Png),
        Ok(ImageType::Jpeg) => Ok(ImageFormat::Jpeg),
        Ok(ImageType::Gif) => Ok(ImageFormat::Gif),
        Ok(ImageType::Webp) => Ok(ImageFormat::Webp),
        Ok(ImageType::Bmp) => Ok(ImageFormat::Bmp),
        // HEIFコンテナのうちAVIFブランド（`avif`、`avio`、`avis`）だけを受け入れる。
        // 同じコンテナのHEIC（`Heif(Compression::Hevc)`）は許可形式に含まれない。
        Ok(ImageType::Heif(Compression::Av1)) => Ok(ImageFormat::Avif),
        _ if is_svg(bytes) => Ok(ImageFormat::Svg),
        _ => Err(ImageRejection::UnsupportedFormat),
    }
}

/// バイト列がSVG文書かを、ルート要素が `svg` であることで判定する。
///
/// 「どこかに `<svg` を含む」では判定しない。それでは任意のテキストファイルの途中に
/// その並びがあるだけでSVGとして配信され、`Content-Type: image/svg+xml` が実体と
/// 食い違う。XMLの前書き（宣言、コメント、DOCTYPE）を読み飛ばし、次に現れる要素が
/// `svg` である場合だけSVGとみなす。
///
/// UTF-16などのUTF-8以外で符号化されたXMLは扱わない。判定できないため許可形式では
/// ないものとして拒否する。
fn is_svg(bytes: &[u8]) -> bool {
    const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
    let rest = bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes);
    let Some(rest) = skip_prologue(rest) else {
        return false;
    };
    let Some(after_name) = rest.strip_prefix(b"<svg") else {
        return false;
    };
    // 要素名の直後は区切りに限る。`<svgx` のような別の要素名を `svg` と読まないため。
    match after_name.first() {
        None | Some(b'>' | b'/') => true,
        Some(byte) => byte.is_ascii_whitespace(),
    }
}

/// XMLの前書き（空白、XML宣言、コメント、DOCTYPE）を読み飛ばす。
///
/// 打ち切られた前書き（閉じが現れない）には `None` を返す。読み飛ばし先を決められない
/// 以上、ルート要素も決められない。
fn skip_prologue(bytes: &[u8]) -> Option<&[u8]> {
    let mut rest = bytes;
    loop {
        let start = rest
            .iter()
            .position(|byte| !byte.is_ascii_whitespace())
            .unwrap_or(rest.len());
        rest = &rest[start..];
        rest = if rest.starts_with(b"<?") {
            skip_to(rest, b"?>")?
        } else if rest.starts_with(b"<!--") {
            skip_to(rest, b"-->")?
        } else if rest.starts_with(b"<!") {
            skip_doctype(rest)?
        } else {
            return Some(rest);
        };
    }
}

/// DOCTYPE宣言を読み飛ばす。
///
/// 内部サブセット（`<!DOCTYPE svg [ ... ]>`）は `>` を含みうるため、`[` があれば
/// 先に `]` まで進めてから `>` を探す。
fn skip_doctype(bytes: &[u8]) -> Option<&[u8]> {
    let close = bytes.iter().position(|byte| *byte == b'>')?;
    let open = bytes.iter().position(|byte| *byte == b'[');
    match open {
        Some(open) if open < close => {
            skip_to(&bytes[open..], b"]").and_then(|rest| skip_to(rest, b">"))
        }
        _ => Some(&bytes[close + 1..]),
    }
}

/// `needle` を探し、その直後から始まる部分を返す。
fn skip_to<'a>(bytes: &'a [u8], needle: &[u8]) -> Option<&'a [u8]> {
    bytes
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|found| &bytes[found + needle.len()..])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 許可形式のサンプル。生成方法は `fixtures/README.md` にある。
    const PNG: &[u8] = include_bytes!("fixtures/sample.png");
    const JPEG: &[u8] = include_bytes!("fixtures/sample.jpg");
    const GIF: &[u8] = include_bytes!("fixtures/sample.gif");
    const WEBP: &[u8] = include_bytes!("fixtures/sample.webp");
    const AVIF: &[u8] = include_bytes!("fixtures/sample.avif");
    const BMP: &[u8] = include_bytes!("fixtures/sample.bmp");
    /// 許可形式ではない画像形式。
    const TIFF: &[u8] = include_bytes!("fixtures/sample.tiff");
    /// 1辺が上限（16384 px）を超える（20000x2）。
    const WIDE: &[u8] = include_bytes!("fixtures/wide.png");
    /// 1辺は上限内で、総ピクセル数が上限（24 Mpx）を超える（16000x1600）。
    const LARGE: &[u8] = include_bytes!("fixtures/large.webp");

    const SVG: &[u8] = br#"<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>"#;

    /// 許可形式は内容から判定でき、`Content-Type` は判定した形式から引く。
    ///
    /// 実ファイルで固定するのは、判定がヘッダーの実際の並びに依存するためである。
    #[test]
    fn allowed_formats_are_detected_from_the_content() {
        let cases = [
            (PNG, ImageFormat::Png, "image/png"),
            (JPEG, ImageFormat::Jpeg, "image/jpeg"),
            (GIF, ImageFormat::Gif, "image/gif"),
            (WEBP, ImageFormat::Webp, "image/webp"),
            (AVIF, ImageFormat::Avif, "image/avif"),
            (BMP, ImageFormat::Bmp, "image/bmp"),
            (SVG, ImageFormat::Svg, "image/svg+xml"),
        ];
        for (bytes, expected, content_type) in cases {
            assert_eq!(validate(bytes), Ok(expected));
            assert_eq!(expected.content_type(), content_type);
        }
    }

    /// 許可形式にない内容は拒否する。
    ///
    /// AVIFと同じHEIFコンテナのHEICを含める。コンテナが同じでも許可形式ではない（7.3）。
    /// サンプルはAVIFのブランドを `heic` へ書き換えて作る。HEICの実ファイルを用意する
    /// 経路がなく、区別しているのはブランドそのものであるため、ここを書き換えれば足りる。
    #[test]
    fn content_outside_the_allowlist_is_rejected() {
        let heic: Vec<u8> = replace_all(AVIF, b"avif", b"heic");
        let cases: [(&[u8], &str); 5] = [
            (TIFF, "TIFF"),
            (&heic, "HEIC"),
            (b"# markdown\n", "テキスト"),
            (b"<html><body><svg></svg></body></html>", "SVGを含むHTML"),
            (b"", "空"),
        ];
        for (bytes, label) in cases {
            assert_eq!(
                validate(bytes),
                Err(ImageRejection::UnsupportedFormat),
                "{label} を受け入れている"
            );
        }
    }

    /// ピクセル寸法の上限は1辺と総数の2つが独立に効く（7.3）。
    #[test]
    fn oversized_pixel_dimensions_are_rejected() {
        let cases: [(&[u8], &str); 2] = [(WIDE, "1辺 20000 px"), (LARGE, "総数 25.6 Mpx")];
        for (bytes, label) in cases {
            assert_eq!(
                validate(bytes),
                Err(ImageRejection::PixelLimitExceeded),
                "{label} を受け入れている"
            );
        }
    }

    /// バイト数の上限は形式の判定より先に効く。
    ///
    /// 上限を超えた入力に対して形式の判定を走らせない。判定できてしまうと、上限で
    /// 落とすべきものが `UnsupportedFormat` 以外の理由で通る余地ができる。
    #[test]
    fn oversized_bytes_are_rejected_before_the_format_is_read() {
        let mut oversized = PNG.to_vec();
        oversized.resize(MAX_IMAGE_BYTES as usize + 1, 0);
        assert_eq!(validate(&oversized), Err(ImageRejection::TooLarge));
    }

    /// 許可形式と判定できても寸法を取れないものは、形式の誤りとは別に表す。
    #[test]
    fn an_image_without_readable_dimensions_reports_a_decode_failure() {
        assert_eq!(validate(&JPEG[..32]), Err(ImageRejection::Decode));
    }

    /// SVGはルート要素が `svg` であることで判定する。
    ///
    /// 「どこかに `<svg` を含む」で判定すると、任意のテキストをSVGとして配信しうる。
    #[test]
    fn svg_is_identified_by_its_root_element() {
        let accepted: [(&[u8], &str); 6] = [
            (b"<svg/>", "最小"),
            (b"<svg xmlns=\"x\"></svg>", "属性つき"),
            (b"\xEF\xBB\xBF<svg/>", "BOMつき"),
            (b"<?xml version=\"1.0\"?>\n<svg/>", "XML宣言つき"),
            (b"<!-- note --><svg/>", "コメントつき"),
            (
                b"<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"svg11.dtd\"><svg/>",
                "DOCTYPEつき",
            ),
        ];
        for (bytes, label) in accepted {
            assert_eq!(
                validate(bytes),
                Ok(ImageFormat::Svg),
                "{label} を拒否している"
            );
        }

        let rejected: [(&[u8], &str); 5] = [
            (b"<svgx/>", "別の要素名"),
            (b"not xml <svg/>", "先頭が要素でない"),
            (b"<?xml version=\"1.0\"?>", "前書きだけ"),
            (b"<!-- <svg/>", "閉じないコメント"),
            (b"<!DOCTYPE svg [<!ENTITY a \"b\">", "閉じないDOCTYPE"),
        ];
        for (bytes, label) in rejected {
            assert_eq!(
                validate(bytes),
                Err(ImageRejection::UnsupportedFormat),
                "{label} をSVGとして受け入れている"
            );
        }
    }

    /// SVGはピクセル寸法の上限の対象外とする。
    ///
    /// ベクター形式であり、宣言された `width` と `height` がラスタライズの大きさを
    /// 決めるとは限らない。抜けのある判定を持つより、バイト数の上限だけで守る。
    #[test]
    fn svg_is_not_subject_to_the_pixel_limit() {
        let huge = br#"<svg xmlns="x" width="100000" height="100000"></svg>"#;
        assert_eq!(validate(huge), Ok(ImageFormat::Svg));
    }

    /// 拒否の区分は発行時と配信時で共有する（design-decisions.md 5.4）。
    ///
    /// 画像の失敗をMarkdown用の `FileTooLarge` や `DecodeFailed` へ倒さない。上限も対象も
    /// 異なる（7.3）。
    #[test]
    fn rejections_map_to_the_image_error_codes() {
        let cases = [
            (
                ImageRejection::UnsupportedFormat,
                ErrorCode::ImageUnsupportedFormat,
            ),
            (ImageRejection::TooLarge, ErrorCode::ImageTooLarge),
            (
                ImageRejection::PixelLimitExceeded,
                ErrorCode::ImagePixelLimitExceeded,
            ),
            (ImageRejection::Decode, ErrorCode::ImageDecodeFailed),
        ];
        for (rejection, expected) in cases {
            assert_eq!(rejection.code(), expected, "{rejection:?}");
        }
    }

    fn replace_all(bytes: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
        let mut replaced = bytes.to_vec();
        let mut index = 0;
        while let Some(found) = replaced[index..]
            .windows(from.len())
            .position(|window| window == from)
        {
            let at = index + found;
            replaced.splice(at..at + from.len(), to.iter().copied());
            index = at + to.len();
        }
        replaced
    }
}
