//! 起動引数の解釈（design-decisions.md 9.2）。
//!
//! 関連付け起動ではファイルの絶対パスがコマンドライン引数として渡る（13.4の実測）。
//! 起動済みインスタンスがある場合、引数は既存インスタンスへ渡される。

use crate::file_kind::is_markdown_path;

/// 起動引数から開く対象を抽出する。
///
/// 引数のうち対象拡張子のものを、渡された順で返す。呼び出し側は先頭から順に開き、
/// 最後の1つをアクティブにする。タブ数が上限（9.1）を超える分は、最も古い非アクティブ
/// タブを閉じて受け入れる。
///
/// 対象拡張子をすべて開くのは、Windowsが「1つのプロセスへ複数の引数」と「ファイル数
/// ぶんのプロセス起動」のどちらで渡すかによらず同じ結果にするためである。後者の場合、
/// 2つ目以降はシングルインスタンス化によって既存インスタンスへ渡り、同じ経路へ集約される。
/// 先頭だけを開く規則では、渡され方によって振る舞いが変わる。
///
/// 同じ文書を重複して開かないため（9.1）、同値の引数は1つにまとめる。比較は文字列一致で
/// 行うため、呼び出し側は7.1の境界判定と同じ正規化を済ませたパスを渡す。
///
/// 実行ファイル自身を指す `argv[0]` は呼び出し側で除く。
pub fn files_to_open(args: &[String]) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    for arg in args {
        if is_markdown_path(arg) && !files.iter().any(|file| file == arg) {
            files.push(arg.clone());
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn files_to_open_keeps_targets_in_order() {
        let cases: [(&str, Vec<&str>, Vec<&str>); 6] = [
            (
                "対象拡張子を渡された順で返す",
                vec![r"C:\docs\b.md", r"C:\docs\a.markdown"],
                vec![r"C:\docs\b.md", r"C:\docs\a.markdown"],
            ),
            (
                "対象外の引数は落とす",
                vec![r"C:\docs\a.md", r"C:\docs\notes.txt", "--debug"],
                vec![r"C:\docs\a.md"],
            ),
            (
                "同じ文書を重複して開かない",
                vec![r"C:\docs\a.md", r"C:\docs\b.md", r"C:\docs\a.md"],
                vec![r"C:\docs\a.md", r"C:\docs\b.md"],
            ),
            (
                "対象が1つもなければ空になる",
                vec!["--debug", r"C:\docs\notes.txt"],
                vec![],
            ),
            ("引数がなければ空になる", vec![], vec![]),
            (
                "大文字の拡張子も対象とする",
                vec![r"C:\docs\A.MD"],
                vec![r"C:\docs\A.MD"],
            ),
        ];

        for (name, input, expected) in cases {
            assert_eq!(files_to_open(&args(&input)), args(&expected), "{name}");
        }
    }
}
