//! ネイティブメニューの構成とアクセラレータ。
//!
//! メニューはTauriのメニューAPIでRust側が構築する（design-decisions.md 10.1）。
//! ここに置くのはコマンドの識別子と割り当てだけであり、メニューの組み立てと
//! 選択の処理はPhase 4で行う。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
/// 表記はTauriのアクセラレータ形式に従う。Windows専用のため `CmdOrCtrl` ではなく
/// `Ctrl` を使う。
///
/// `Ctrl` + `+` / `-` / `0` を文字サイズへ割り当てるため、WebViewのズームホットキーは
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
    (MenuCommand::IncreaseFontSize, "Ctrl+Plus"),
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

#[cfg(test)]
mod tests {
    use super::*;

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
