//! ツリーと関連付けの対象となるファイルの判定。
//!
//! 対象の定義は design-decisions.md 6.3 を正本とする。走査、監視の畳み込み、
//! 起動引数の解釈がいずれもこの判定を使う。

use std::path::Path;

/// 対象とする拡張子（design-decisions.md 6.3）。
pub const MARKDOWN_EXTENSIONS: [&str; 2] = ["md", "markdown"];

/// パスが対象の拡張子を持つかを返す。
///
/// 比較は大文字小文字を区別しない。Windowsのファイルシステムが区別せず、
/// エクスプローラーから渡されるパスの表記も一定ではないためである（6.2、7.1）。
///
/// 判定するのは拡張子だけであり、除外対象（6.2）配下かどうかは呼び出し側で見る。
pub fn is_markdown_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|target| extension.eq_ignore_ascii_case(target))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_paths_are_recognized() {
        let cases = [
            ("a.md", true),
            ("a.markdown", true),
            ("docs/a.md", true),
            (r"C:\docs\a.md", true),
            // 大文字小文字を区別しない。
            ("A.MD", true),
            ("a.Markdown", true),
            // 一時ファイルは対象外。atomic replaceと通常のrenameを分ける基準になる（6.5）。
            ("a.md.tmp", false),
            ("a.md.bak", false),
            ("a.txt", false),
            ("a", false),
            // 拡張子のないドットファイル。`Path::extension` は `None` を返す。
            (".md", false),
            ("", false),
        ];
        for (path, expected) in cases {
            assert_eq!(is_markdown_path(path), expected, "入力: {path}");
        }
    }
}
