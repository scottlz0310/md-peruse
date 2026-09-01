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
/// `.md` のように拡張子だけの名前も対象とする。`Path::extension` はこれを拡張子なしと
/// 見なすが、リンク解決（`src/markdown/link-target.ts`）は末尾一致で判定しており、
/// そちらへ揃えないと「リンクからは開けるのにツリーへ出ない」ファイルが生じる。
///
/// 判定するのは名前の末尾だけであり、除外対象（6.2）配下かどうかは呼び出し側で見る。
/// ディレクトリ名は見ない。`docs.md/notes.txt` を対象と誤判定しないためである。
pub fn is_markdown_path(path: &str) -> bool {
    let name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    MARKDOWN_EXTENSIONS.iter().any(|extension| {
        name.strip_suffix(extension)
            .is_some_and(|stem| stem.ends_with('.'))
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
            ("md", false),
            ("", false),
            // 拡張子だけの名前。リンク解決（`src/markdown/link-target.ts`）と揃える。
            (".md", true),
            (".markdown", true),
            ("docs/.md", true),
            // ディレクトリ名は見ない。
            ("docs.md/notes.txt", false),
            (r"C:\docs.md\notes.txt", false),
        ];
        for (path, expected) in cases {
            assert_eq!(is_markdown_path(path), expected, "入力: {path}");
        }
    }
}
