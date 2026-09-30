//! アプリを起動できなかったことを、ネイティブのダイアログで示す（spec.md 4.4、
//! design-decisions.md 12章）。
//!
//! WebView2 Runtime が無い、または初期化できないと、ウィンドウ（WebView）を作れず、Frontend も
//! IPC も成立しない。原因を示せるのはネイティブ側だけである。Tauri（wry）は、Runtime が見つから
//! ないときだけ英語のダイアログを出す。それ以外の初期化失敗（利用者データのフォルダーを使えない、
//! など）は何も示さず、`setup` の失敗を Tauri が panic にして、ウィンドウも文言も無いまま
//! 異常終了していた（実測）。ここでは、ウィンドウを作る処理の失敗を、UI言語で、原因と Microsoft の
//! 公式の修復先とともに示してから、終了する。

use crate::i18n::Language;
use std::fmt::Display;
use windows::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MB_SETFOREGROUND, MessageBoxW};
use windows::core::HSTRING;

/// Microsoft の公式の、WebView2 Runtime の入手先。
pub const WEBVIEW2_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

const TITLE: &str = "md-peruse";

/// 起動できなかったことの案内。`cause` は失敗の内容（Tauri のエラー）である。
pub fn failure_message(language: Language, cause: &dyn Display) -> String {
    match language {
        Language::Ja => format!(
            "md-peruse を起動できませんでした。\n\n\
             画面の表示に使う WebView2 Runtime が、インストールされていない、または壊れている\
             可能性があります。次の Microsoft の公式ページから、インストールまたは修復してください。\n\n\
             {WEBVIEW2_URL}\n\n\
             詳細: {cause}"
        ),
        Language::En => format!(
            "md-peruse could not start.\n\n\
             The WebView2 Runtime that md-peruse uses to display its window may be missing or damaged. \
             Install or repair it from the official Microsoft page below.\n\n\
             {WEBVIEW2_URL}\n\n\
             Details: {cause}"
        ),
    }
}

/// 案内を `show`（タイトルと本文を受け取る）で示す。
pub fn report_with(language: Language, cause: &dyn Display, show: impl FnOnce(&str, &str)) {
    show(TITLE, &failure_message(language, cause));
}

/// 起動できなかったことを、ネイティブのダイアログとして示し、プロセスを終了する。
///
/// `setup` は Tauri の起動処理の中で呼ばれ、失敗を返すと Tauri が panic にする（異常終了して
/// ダイアログも残らない）。そのため、返さずにここで終了する。ダイアログを閉じるまで待つ。
pub fn exit_after_report(language: Language, cause: &dyn Display) -> ! {
    report_with(language, cause, show_blocking);
    std::process::exit(1);
}

/// OKだけのメッセージボックスを示し、閉じるまで待つ。
///
/// イベントループが始まる前でも使える。Tauri のダイアログのプラグインは、アプリを作った後の
/// ハンドルが要るため使えない。
fn show_blocking(title: &str, text: &str) {
    // SAFETY: 引数は、この呼び出しの間生きている `HSTRING` の借用である。所有ウィンドウは
    // 無く（`None`）、戻り値のボタンは使わない。
    unsafe {
        MessageBoxW(
            None,
            &HSTRING::from(text),
            &HSTRING::from(title),
            MB_OK | MB_ICONERROR | MB_SETFOREGROUND,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn the_official_page_is_microsofts_https_address() {
        assert!(WEBVIEW2_URL.starts_with("https://developer.microsoft.com/"));
    }

    #[test]
    fn the_message_carries_the_cause_and_the_official_page_in_each_language() {
        let cases = [
            (Language::Ja, "起動できませんでした", "詳細: "),
            (Language::En, "could not start", "Details: "),
        ];
        for (language, phrase, detail_label) in cases {
            let message = failure_message(language, &"failed to create webview");
            assert!(message.contains(phrase), "{language:?}: {message}");
            assert!(message.contains(WEBVIEW2_URL), "{language:?}: {message}");
            assert!(
                message.contains(&format!("{detail_label}failed to create webview")),
                "{language:?}: {message}"
            );
        }
    }

    #[test]
    fn the_languages_do_not_share_a_message() {
        let cause = "x";
        assert_ne!(
            failure_message(Language::Ja, &cause),
            failure_message(Language::En, &cause)
        );
    }

    #[test]
    fn reporting_shows_the_title_and_the_message_once() {
        let shown = RefCell::new(Vec::new());
        report_with(Language::En, &"boom", |title, text| {
            shown.borrow_mut().push((title.to_owned(), text.to_owned()));
        });
        let shown = shown.into_inner();
        assert_eq!(shown.len(), 1);
        assert_eq!(shown[0].0, "md-peruse");
        assert_eq!(shown[0].1, failure_message(Language::En, &"boom"));
    }
}
