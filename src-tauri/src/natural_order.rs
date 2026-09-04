//! ツリーの並び順に使う自然順の比較。
//!
//! 名前に含まれる数字列を数値として比較する。`a2.md` を `a10.md` より前に置くためで
//! あり、章番号を名前へ付けた文書（`01-intro.md`、`10-api.md`）を扱うMarkdownビューワー
//! では辞書順よりも期待に沿う。エクスプローラーとVS Codeの並びもこれである。
//!
//! 規則はWindowsの `StrCmpLogicalW` を実測して定めた（Windows 11 26200）。
//!
//! | 入力 | 実測 | 本実装 |
//! | --- | --- | --- |
//! | `a1` と `a01` と `a001` | `a001` < `a01` < `a1` | 同じ |
//! | `a2` と `a10` | `a2` < `a10` | 同じ |
//! | `a` と `a1` | `a` < `a1` | 同じ |
//! | `A1` と `a1` | 等しい | 大文字小文字で決める |
//! | 20桁を超える数字列 | 破綻する | 桁数で比較する |
//! | `あ` と `ア` | `ア` < `あ` | コードポイント順 |
//!
//! `StrCmpLogicalW` そのものは呼ばない。ロケールとOSの版で結果が変わる比較をツリーの
//! 並びに持ち込むと、同じフォルダーが環境によって違う順序で表示され、テストでも固定
//! できないためである。数字列の比較だけを取り入れ、それ以外は小文字化したコードポイント
//! 順とする。日本語の仮名の並びが `StrCmpLogicalW` と異なるのはこのためである。
//!
//! 20桁を超える数字列で `StrCmpLogicalW` は `99999999999999999999` を
//! `100000000000000000000` より大きいと返す（実測）。数値へ変換せず、先頭のゼロを
//! 除いた桁数で比較することでこれを避ける。

use std::cmp::Ordering;

/// 名前を自然順で比較する。
///
/// すべての要素が等しいときは元の文字列で決める。大文字小文字だけが異なる名前は
/// 同じフォルダーに共存できないが、比較を全順序にしておかないと並びが実行ごとに
/// 変わりうる。
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut left = a;
    let mut right = b;
    loop {
        // 数字列をまとめて数値として比べるのは、両方が数字で始まるときだけである。
        // 片方だけが数字なら1文字ずつの比較へ倒す。`a.md` と `a1.md` は、`.` と `1` を
        // 文字として比べて決まる（`.` が先）。数字までをまとめて比べると `a.md` 全体と
        // `a` の比較になり、順序が逆になる。
        if starts_with_digit(left) && starts_with_digit(right) {
            let (left_digits, left_rest) = split_digits(left);
            let (right_digits, right_rest) = split_digits(right);
            match compare_digits(left_digits, right_digits) {
                Ordering::Equal => {
                    left = left_rest;
                    right = right_rest;
                }
                ordering => return ordering,
            }
            continue;
        }
        let mut left_chars = left.chars();
        let mut right_chars = right.chars();
        match (left_chars.next(), right_chars.next()) {
            // 片方が尽きたら、尽きたほうが先。`a` が `a1` より前に来る。
            (None, None) => break,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(left_char), Some(right_char)) => {
                match left_char.to_lowercase().cmp(right_char.to_lowercase()) {
                    Ordering::Equal => {
                        left = left_chars.as_str();
                        right = right_chars.as_str();
                    }
                    ordering => return ordering,
                }
            }
        }
    }
    a.cmp(b)
}

fn starts_with_digit(value: &str) -> bool {
    value.starts_with(|c: char| c.is_ascii_digit())
}

fn split_digits(value: &str) -> (&str, &str) {
    let end = value
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(value.len());
    value.split_at(end)
}

/// 数字列どうしを比較する。
///
/// 数値へ変換しない。`u64` は20桁で溢れ、それ以上の数字列を名前に持つファイルで
/// 比較が破綻する。先頭のゼロを除けば、桁数の多いほうが大きい。
fn compare_digits(left: &str, right: &str) -> Ordering {
    let left_value = left.trim_start_matches('0');
    let right_value = right.trim_start_matches('0');
    left_value
        .len()
        .cmp(&right_value.len())
        .then_with(|| left_value.cmp(right_value))
        // 数値が等しいときは先頭のゼロが多いほうを先にする（実測でエクスプローラーと一致）。
        .then_with(|| right.len().cmp(&left.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_compared_in_natural_order() {
        let cases = [
            // 数字列は数値として比べる。辞書順ではここが逆になる。
            ("a2.md", "a10.md", Ordering::Less),
            ("a10.md", "a2.md", Ordering::Greater),
            ("01-intro.md", "10-api.md", Ordering::Less),
            ("1.md", "10.md", Ordering::Less),
            // 先頭のゼロが多いほうが先（実測）。
            ("a001.md", "a01.md", Ordering::Less),
            ("a01.md", "a1.md", Ordering::Less),
            ("01.md", "1.md", Ordering::Less),
            // 数字を持たない名前が先。
            ("a.md", "a1.md", Ordering::Less),
            ("a1.md", "a1b.md", Ordering::Less),
            // 数字で始まる名前は文字で始まる名前より前。
            ("1a.md", "a1.md", Ordering::Less),
            // 大文字小文字を区別しない。
            ("apple.md", "Banana.md", Ordering::Less),
            ("Apple.md", "banana.md", Ordering::Less),
            // 名前の途中の数字も対象。
            ("file1v2.md", "file1v10.md", Ordering::Less),
            ("v1/a.md", "v10/a.md", Ordering::Less),
            // 20桁を超える数字列。`StrCmpLogicalW` はここで破綻する（実測）。
            (
                "99999999999999999999.md",
                "100000000000000000000.md",
                Ordering::Less,
            ),
            // 記号はコードポイント順。
            ("_a.md", "a.md", Ordering::Less),
            // 同じ名前。
            ("a.md", "a.md", Ordering::Equal),
        ];
        for (left, right, expected) in cases {
            assert_eq!(natural_cmp(left, right), expected, "{left} vs {right}");
            assert_eq!(
                natural_cmp(right, left),
                expected.reverse(),
                "{right} vs {left}"
            );
        }
    }

    #[test]
    fn comparison_is_a_total_order() {
        // 大文字小文字だけが異なる名前は同じフォルダーに共存できないが、
        // 比較としては決着させる。
        assert_eq!(natural_cmp("A1.md", "a1.md"), Ordering::Less);
        assert_eq!(natural_cmp("a1.md", "A1.md"), Ordering::Greater);
    }

    #[test]
    fn sorting_matches_the_expected_order() {
        let mut names = vec![
            "10-api.md",
            "2-setup.md",
            "01-intro.md",
            "readme.md",
            "a01.md",
            "a1.md",
            "a.md",
            "A.markdown",
        ];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(
            names,
            [
                "01-intro.md",
                "2-setup.md",
                "10-api.md",
                "A.markdown",
                "a.md",
                "a01.md",
                "a1.md",
                "readme.md",
            ]
        );
    }
}
