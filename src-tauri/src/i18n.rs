//! UI言語の決定（design-decisions.md 10.5）。
//!
//! 初期版は日本語と英語を提供する。表示文言はRust側とFrontend側の双方が持つ。
//! ネイティブメニュー（10.1）とネイティブダイアログはRustが構築し、`IpcError` の
//! `message` もRustが選択中の言語で組み立てる（5.3）。プレビュー領域とWebView内の
//! UIはFrontendが持つ。
//!
//! ここに置くのは型と解決規則だけであり、OSの表示言語の取得とメニューの再構築は
//! Phase 4で実装する。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 実際に表示する言語。
///
/// 設定値の `LanguagePreference` と分けるのは、`System` を選んだときの実際の言語を
/// 表す値が別に要るためである。配色の `Theme` と `ThemePreference` と同じ関係にある。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum Language {
    Ja,
    En,
}

/// UI言語の設定値。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum LanguagePreference {
    #[default]
    System,
    Ja,
    En,
}

/// 対応する言語のどれにも当たらないときに使う言語。
///
/// 日本語ではなく英語へ倒すのは、対応外の言語圏の利用者にとって英語のほうが読める
/// 見込みが高いためである。日本語を既定にすると、日本語を読めない利用者へ読めないUIが
/// 出る。
pub const FALLBACK_LANGUAGE: Language = Language::En;

/// 設定値とOSの表示言語から、実際に表示する言語を決める。
///
/// `os_language_tag` はBCP 47の言語タグ（`ja-JP`、`en-US` など）を想定する。判定には
/// 一次サブタグだけを使い、地域や表記体系のサブタグは見ない。`ja-JP` と `ja` を別の
/// 言語として扱う理由がないためである。
///
/// OSの表示言語の取得はPhase 4で実装する。取得できなかった場合は空文字を渡し、
/// `FALLBACK_LANGUAGE` を得る。
pub fn resolve_language(preference: LanguagePreference, os_language_tag: &str) -> Language {
    match preference {
        LanguagePreference::Ja => Language::Ja,
        LanguagePreference::En => Language::En,
        LanguagePreference::System => match primary_subtag(os_language_tag).as_str() {
            "ja" => Language::Ja,
            "en" => Language::En,
            _ => FALLBACK_LANGUAGE,
        },
    }
}

/// 言語タグの一次サブタグを小文字で返す。
///
/// 区切りはハイフンのほか、`ja_JP` 形式で渡された場合に備えてアンダースコアも見る。
fn primary_subtag(language_tag: &str) -> String {
    language_tag
        .split(['-', '_'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_language_follows_preference_and_os_tag() {
        let cases = [
            (
                "日本語を選べば日本語",
                LanguagePreference::Ja,
                "en-US",
                Language::Ja,
            ),
            (
                "英語を選べば英語",
                LanguagePreference::En,
                "ja-JP",
                Language::En,
            ),
            (
                "systemで日本語のOSは日本語",
                LanguagePreference::System,
                "ja-JP",
                Language::Ja,
            ),
            (
                "地域サブタグのない指定も一次サブタグで判定する",
                LanguagePreference::System,
                "ja",
                Language::Ja,
            ),
            (
                "大文字小文字を区別しない",
                LanguagePreference::System,
                "JA-JP",
                Language::Ja,
            ),
            (
                "アンダースコア区切りも一次サブタグで判定する",
                LanguagePreference::System,
                "ja_JP",
                Language::Ja,
            ),
            (
                "systemで英語のOSは英語",
                LanguagePreference::System,
                "en-GB",
                Language::En,
            ),
            (
                "対応しない言語はフォールバックへ倒す",
                LanguagePreference::System,
                "fr-FR",
                FALLBACK_LANGUAGE,
            ),
            (
                "取得できなかったときもフォールバックへ倒す",
                LanguagePreference::System,
                "",
                FALLBACK_LANGUAGE,
            ),
        ];

        for (name, preference, tag, expected) in cases {
            assert_eq!(resolve_language(preference, tag), expected, "{name}");
        }
    }

    /// 既定の設定値がOSへ追従することを固定する。
    #[test]
    fn default_preference_follows_the_os() {
        assert_eq!(LanguagePreference::default(), LanguagePreference::System);
    }

    /// JSONの表記が設定ファイルとTypeScriptの生成物で一致することを固定する。
    #[test]
    fn preference_serializes_in_lower_case() {
        let cases = [
            (LanguagePreference::System, "\"system\""),
            (LanguagePreference::Ja, "\"ja\""),
            (LanguagePreference::En, "\"en\""),
        ];
        for (value, expected) in cases {
            let json = serde_json::to_string(&value).expect("直列化できる");
            assert_eq!(json, expected);
        }
    }
}
