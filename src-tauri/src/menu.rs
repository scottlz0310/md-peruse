//! ネイティブメニューの構成とアクセラレータ。
//!
//! メニューはTauriのメニューAPIでRust側が構築する（design-decisions.md 10.1）。
//! ここに置くのはコマンドの識別子、割り当て、表示名、メニューの組み立てである。選択の
//! 処理は `crate::open_folder` などコマンドごとの担当が持つ。

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Manager, Runtime};
use ts_rs::TS;

use crate::i18n::Language;

/// メニュー項目が表すコマンド。
///
/// Rust側で処理するものと、eventでFrontendへ渡すものの両方を含む。担当の区分は
/// design-decisions.md 10.1 の表を正本とする。Frontendからメニューを操作しないため、
/// `menu` 系のcapabilityは追加しない（5.5）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum MenuCommand {
    /// フォルダーを開く。ネイティブダイアログを開き、ワークスペースを切り替える。
    OpenFolder,
    /// 最近使ったフォルダーから開く。項目は実行時に構築する（11.1）。
    OpenRecentFolder,
    /// ワークスペースを閉じ、welcome状態へ戻す（6.1）。
    CloseWorkspace,
    /// アクティブなタブを閉じる。
    CloseTab,
    /// サイドバーの表示を切り替える（10.2）。
    ToggleSidebar,
    /// 表示中の文書を読み直す。
    ///
    /// 監視のバッファあふれや監視停止（`WatcherStopped`）からの回復手段であり、
    /// 自動追従が効かない状況でユーザーが取れる唯一の行動である（6.4）。
    ReloadDocument,
    /// 配色テーマをOSの設定に従わせる。
    UseSystemTheme,
    /// 配色テーマをライトに固定する。
    UseLightTheme,
    /// 配色テーマをダークに固定する。
    UseDarkTheme,
    /// UIの表示言語をOSの表示言語へ従わせる（10.5）。
    UseSystemLanguage,
    /// UIの表示言語を日本語に固定する。
    UseJapanese,
    /// UIの表示言語を英語に固定する。
    UseEnglish,
    /// プレビュー本文の文字を大きくする（10.3）。
    IncreaseFontSize,
    /// プレビュー本文の文字を小さくする。
    DecreaseFontSize,
    /// プレビュー本文の文字サイズを既定へ戻す。
    ResetFontSize,
    /// バージョンと依存ライセンス一覧を表示する（11.3）。
    About,
    /// アプリを終了する。
    Exit,
}

/// アクセラレータを持つコマンドとその割り当て。
///
/// 表記はTauriが内部で使う `muda` のアクセラレータ形式に従う。キーはW3Cの
/// `KeyboardEvent.code` に対応する名前であり、`Plus` のような記号名は受け付けない。
/// Tauriはパースに失敗した文字列を無言で捨てるため、実行するまで登録されていないことに
/// 気づけない。`accelerators_are_parsable` で実際のパーサーへ通して固定する。
///
/// Windows専用のため `CmdOrCtrl` ではなく `Ctrl` を使う。
///
/// 文字サイズの拡大は `Ctrl+Equal`（`=` キー）とする。`muda` のアクセラレータは修飾キーを
/// 厳密に見るため、1つの項目で `Ctrl+=` と `Ctrl+Shift+=`（`Ctrl` + `+`）の両方は表せない。
/// メニューには代表として `Ctrl+Equal` を表示し、`Ctrl+Shift+Equal` とテンキーの
/// `Ctrl+NumpadAdd` / `Ctrl+NumpadSubtract` はWebView内で同じ操作へ割り当てる（10.3）。
///
/// `Ctrl` + `=` / `-` / `0` を文字サイズへ割り当てるため、WebViewのズームホットキーは
/// 無効にする。有効なままだと、WebView全体の拡大とプレビュー本文の拡大が同じキーで
/// 二重に起きる。本文だけを拡大する方針（10.3）を保つため、無効化はwebviewの設定で行う。
///
/// タブの移動（`Ctrl+Tab`、`Ctrl+Shift+Tab`）とツリーの操作（矢印、`Enter`、`Home`、
/// `End`）はメニュー項目を持たず、WebView内で処理する（10章）。ここに載せないのは、
/// メニューに現れない操作のアクセラレータをネイティブ側で奪うと、フォーカスのある
/// 要素へキーが届かなくなるためである。
pub const ACCELERATORS: [(MenuCommand, &str); 7] = [
    (MenuCommand::OpenFolder, "Ctrl+O"),
    (MenuCommand::CloseTab, "Ctrl+W"),
    (MenuCommand::ToggleSidebar, "Ctrl+B"),
    (MenuCommand::ReloadDocument, "F5"),
    (MenuCommand::IncreaseFontSize, "Ctrl+Equal"),
    (MenuCommand::DecreaseFontSize, "Ctrl+Minus"),
    (MenuCommand::ResetFontSize, "Ctrl+0"),
];

/// コマンドに割り当てられたアクセラレータを返す。持たない場合は `None`。
pub fn accelerator_of(command: MenuCommand) -> Option<&'static str> {
    ACCELERATORS
        .iter()
        .find(|(candidate, _)| *candidate == command)
        .map(|(_, accelerator)| *accelerator)
}

impl MenuCommand {
    /// メニュー項目のID。Frontendへ渡す識別子（camelCase）と同じ文字列にする。
    pub fn id(self) -> String {
        serde_json::to_value(self)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .expect("MenuCommand は文字列へ直列化される")
    }

    /// メニュー項目のIDからコマンドを引く。アプリが作っていない項目のIDには `None` を返す。
    pub fn from_id(id: &str) -> Option<Self> {
        serde_json::from_value(serde_json::Value::String(id.to_owned())).ok()
    }
}

/// 現在メニューへ載せているコマンド。
///
/// 処理を実装したものだけを載せる。押しても何も起きない項目を見せないためであり、
/// 無効表示にもしない。実装が進むたびにここへ加え、10.1の構成へ近づける。
pub const IMPLEMENTED: [MenuCommand; 2] = [MenuCommand::OpenFolder, MenuCommand::Exit];

/// コマンドの表示名。
///
/// `IMPLEMENTED` に載せるコマンドだけが対象である。載せていないコマンドの表示名は、
/// 実装するときに10.1の表から足す。
fn label(command: MenuCommand, language: Language) -> &'static str {
    match (command, language) {
        (MenuCommand::OpenFolder, Language::Ja) => "フォルダーを開く(&O)...",
        (MenuCommand::OpenFolder, Language::En) => "&Open Folder...",
        (MenuCommand::Exit, Language::Ja) => "終了(&X)",
        (MenuCommand::Exit, Language::En) => "E&xit",
        _ => unreachable!("メニューへ載せていないコマンドの表示名: {command:?}"),
    }
}

fn file_menu_label(language: Language) -> &'static str {
    match language {
        Language::Ja => "ファイル(&F)",
        Language::En => "&File",
    }
}

/// メニューを組み立てる。
///
/// 終了は `PredefinedMenuItem::quit` を使わず、自前の項目にする。コマンドの識別子を
/// 1つの経路（`MenuCommand::from_id`）で扱い、メニューの選択をすべて同じ場所で処理する
/// ためである。
pub fn build<R: Runtime, M: Manager<R>>(manager: &M, language: Language) -> tauri::Result<Menu<R>> {
    let item = |command: MenuCommand| {
        MenuItem::with_id(
            manager,
            command.id(),
            label(command, language),
            true,
            accelerator_of(command),
        )
    };
    let file = Submenu::with_items(
        manager,
        file_menu_label(language),
        true,
        &[
            &item(MenuCommand::OpenFolder)?,
            &PredefinedMenuItem::separator(manager)?,
            &item(MenuCommand::Exit)?,
        ],
    )?;
    Menu::with_items(manager, &[&file])
}

#[cfg(test)]
mod tests {
    use super::*;
    use muda::accelerator::Accelerator;

    /// メニュー項目のIDとコマンドは往復できる。
    #[test]
    fn command_ids_round_trip() {
        for command in IMPLEMENTED {
            assert_eq!(MenuCommand::from_id(&command.id()), Some(command));
        }
        assert_eq!(MenuCommand::OpenFolder.id(), "openFolder");
        // アプリが作っていないID（Tauriの既定項目など）はコマンドにならない。
        assert_eq!(MenuCommand::from_id("quit"), None);
    }

    /// 載せたコマンドはすべて両言語の表示名を持つ。
    #[test]
    fn implemented_commands_have_labels() {
        for command in IMPLEMENTED {
            for language in [Language::Ja, Language::En] {
                assert!(!label(command, language).is_empty());
            }
        }
    }

    /// `mock_app` 上でメニューを組み立てられ、載せたコマンドだけが項目になる。
    #[test]
    fn the_menu_contains_only_implemented_commands() {
        let app = tauri::test::mock_app();
        let menu = build(app.handle(), Language::Ja).expect("メニューを組み立てられない");
        // `Menu::get` はサブメニューの中を探さないため、ファイルメニューから引く。
        let items = menu.items().expect("メニューの項目を取れない");
        let file = items[0].as_submenu().expect("先頭がサブメニューではない");

        for command in IMPLEMENTED {
            assert!(file.get(&command.id()).is_some(), "{command:?} が無い");
        }
        assert!(file.get(&MenuCommand::CloseTab.id()).is_none());
    }

    /// すべての割り当てが実際のパーサーを通ることを固定する。
    ///
    /// Tauriはメニュー項目へ渡された文字列を `muda` でパースし、失敗した場合は
    /// アクセラレータなしとして扱う。エラーを返さないため、`Ctrl+Plus` のような
    /// 無効な表記はビルドもテストも通り、実行時に「効かないショートカット」になる。
    /// 実物のパーサーへ通すことでしか防げない。
    #[test]
    fn accelerators_are_parsable() {
        for (command, accelerator) in ACCELERATORS {
            assert!(
                accelerator.parse::<Accelerator>().is_ok(),
                "パースできないアクセラレータ: {accelerator}（{command:?}）"
            );
        }
    }

    /// このテストが実際に無効な表記を捕まえることを確かめる。
    ///
    /// パーサーが何でも受け入れるようになると `accelerators_are_parsable` は
    /// 素通りするため、既知の無効な表記で反証を取る。
    #[test]
    fn invalid_accelerators_are_rejected() {
        for invalid in ["Ctrl+Plus", "Ctrl+", "Meta+Nope"] {
            assert!(
                invalid.parse::<Accelerator>().is_err(),
                "無効なはずの表記が通った: {invalid}"
            );
        }
    }

    /// 同じキーに2つのコマンドを割り当てないことを固定する。
    ///
    /// 重複するとTauriは後勝ちで登録し、失敗を返さない。実行するまで気づけないため、
    /// ここで止める。
    #[test]
    fn accelerators_are_unique() {
        for (index, (command, accelerator)) in ACCELERATORS.iter().enumerate() {
            let duplicated = ACCELERATORS
                .iter()
                .skip(index + 1)
                .any(|(_, other)| other == accelerator);
            assert!(
                !duplicated,
                "重複したアクセラレータ: {accelerator}（{command:?}）"
            );
        }
    }

    /// 1つのコマンドに2つのキーを割り当てないことを固定する。
    #[test]
    fn commands_appear_at_most_once() {
        for (index, (command, _)) in ACCELERATORS.iter().enumerate() {
            let duplicated = ACCELERATORS
                .iter()
                .skip(index + 1)
                .any(|(other, _)| other == command);
            assert!(!duplicated, "重複したコマンド: {command:?}");
        }
    }

    #[test]
    fn accelerator_of_finds_assignments() {
        assert_eq!(accelerator_of(MenuCommand::OpenFolder), Some("Ctrl+O"));
        assert_eq!(accelerator_of(MenuCommand::CloseWorkspace), None);
    }
}
