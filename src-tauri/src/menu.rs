//! ネイティブメニューの構成とアクセラレータ。
//!
//! メニューはTauriのメニューAPIでRust側が構築する（design-decisions.md 10.1）。
//! ここに置くのはコマンドの識別子、割り当て、表示名、メニューの組み立てである。選択の
//! 処理は `crate::open_folder` などコマンドごとの担当が持つ。

use serde::{Deserialize, Serialize};
use tauri::menu::{
    CheckMenuItem, IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
};
use tauri::{AppHandle, Manager, Runtime};
use ts_rs::TS;

use crate::i18n::{Language, LanguagePreference};
use crate::language;
use crate::recent::{MENU_ITEM_PREFIX, RecentFolders};
use crate::settings::{RecentFolderView, ThemePreference};
use crate::settings_store::SettingsStore;
use crate::state::AppState;
use crate::theme;

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
/// メニューには代表として `Ctrl+Equal` を表示し、`Ctrl` + `+` とテンキーの
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
pub const IMPLEMENTED: [MenuCommand; 17] = [
    MenuCommand::OpenFolder,
    MenuCommand::OpenRecentFolder,
    MenuCommand::CloseWorkspace,
    MenuCommand::CloseTab,
    MenuCommand::Exit,
    MenuCommand::ToggleSidebar,
    MenuCommand::ReloadDocument,
    MenuCommand::UseSystemTheme,
    MenuCommand::UseLightTheme,
    MenuCommand::UseDarkTheme,
    MenuCommand::UseSystemLanguage,
    MenuCommand::UseJapanese,
    MenuCommand::UseEnglish,
    MenuCommand::IncreaseFontSize,
    MenuCommand::DecreaseFontSize,
    MenuCommand::ResetFontSize,
    MenuCommand::About,
];

/// コマンドの表示名。
///
/// すべてのコマンドについて、両言語の表示名を持つ。コマンドを足したときの不足は、
/// この `match` の網羅性検査が検出する。
fn label(command: MenuCommand, language: Language) -> &'static str {
    match (command, language) {
        (MenuCommand::OpenFolder, Language::Ja) => "フォルダーを開く(&O)...",
        (MenuCommand::OpenFolder, Language::En) => "&Open Folder...",
        (MenuCommand::OpenRecentFolder, Language::Ja) => "最近使ったフォルダー(&R)",
        (MenuCommand::OpenRecentFolder, Language::En) => "&Recent Folders",
        (MenuCommand::CloseWorkspace, Language::Ja) => "ワークスペースを閉じる(&K)",
        (MenuCommand::CloseWorkspace, Language::En) => "Close Wor&kspace",
        (MenuCommand::CloseTab, Language::Ja) => "タブを閉じる(&W)",
        (MenuCommand::CloseTab, Language::En) => "&Close Tab",
        (MenuCommand::Exit, Language::Ja) => "終了(&X)",
        (MenuCommand::Exit, Language::En) => "E&xit",
        (MenuCommand::ToggleSidebar, Language::Ja) => "サイドバーの表示切り替え(&S)",
        (MenuCommand::ToggleSidebar, Language::En) => "Toggle &Sidebar",
        (MenuCommand::ReloadDocument, Language::Ja) => "再読み込み(&R)",
        (MenuCommand::ReloadDocument, Language::En) => "&Reload",
        (MenuCommand::UseSystemTheme, Language::Ja) => "システム(&S)",
        (MenuCommand::UseSystemTheme, Language::En) => "&System",
        (MenuCommand::UseLightTheme, Language::Ja) => "ライト(&L)",
        (MenuCommand::UseLightTheme, Language::En) => "&Light",
        (MenuCommand::UseDarkTheme, Language::Ja) => "ダーク(&D)",
        (MenuCommand::UseDarkTheme, Language::En) => "&Dark",
        (MenuCommand::UseSystemLanguage, Language::Ja) => "システム(&S)",
        (MenuCommand::UseSystemLanguage, Language::En) => "&System",
        // 言語名は、現在のUI言語によらずその言語で書く。読めない言語のUIになったときも、
        // 自分の言語の項目を見つけて戻せるようにするためである。
        (MenuCommand::UseJapanese, _) => "日本語(&J)",
        (MenuCommand::UseEnglish, _) => "English(&E)",
        (MenuCommand::IncreaseFontSize, Language::Ja) => "文字を大きく(&I)",
        (MenuCommand::IncreaseFontSize, Language::En) => "&Increase Font Size",
        (MenuCommand::DecreaseFontSize, Language::Ja) => "文字を小さく(&D)",
        (MenuCommand::DecreaseFontSize, Language::En) => "&Decrease Font Size",
        (MenuCommand::ResetFontSize, Language::Ja) => "文字サイズを既定に戻す(&E)",
        (MenuCommand::ResetFontSize, Language::En) => "R&eset Font Size",
        (MenuCommand::About, Language::Ja) => "md-peruse について(&A)",
        (MenuCommand::About, Language::En) => "&About md-peruse",
    }
}

fn file_menu_label(language: Language) -> &'static str {
    match language {
        Language::Ja => "ファイル(&F)",
        Language::En => "&File",
    }
}

fn view_menu_label(language: Language) -> &'static str {
    match language {
        Language::Ja => "表示(&V)",
        Language::En => "&View",
    }
}

fn help_menu_label(language: Language) -> &'static str {
    match language {
        Language::Ja => "ヘルプ(&H)",
        Language::En => "&Help",
    }
}

fn theme_menu_label(language: Language) -> &'static str {
    match language {
        Language::Ja => "テーマ(&T)",
        Language::En => "&Theme",
    }
}

fn language_menu_label(language: Language) -> &'static str {
    match language {
        Language::Ja => "言語(&L)",
        Language::En => "&Language",
    }
}

/// メニューの項目名として、文字をそのまま表示する形へ直す。
///
/// メニューの項目名では `&` がアクセスキーの印になる。フォルダー名に含まれる `&` を、
/// 印ではなく文字として表示するため、重ねて書く。
fn literal(text: &str) -> String {
    text.replace('&', "&&")
}

/// メニューを組み立てる。`theme` と `language_preference` は保存済みの選択で、その項目に
/// チェックを付ける。`language` は表示に使う実際の言語である。`recent_folders` は
/// 「最近使ったフォルダー」の項目になる（空ならサブメニューごと無効にする）。
///
/// 終了は `PredefinedMenuItem::quit` を使わず、自前の項目にする。コマンドの識別子を
/// 1つの経路（`MenuCommand::from_id`）で扱い、メニューの選択をすべて同じ場所で処理する
/// ためである。最近使ったフォルダーの項目だけは、項目ごとにIDが要るため
/// `MENU_ITEM_PREFIX` を前置きした別のIDにする（`crate::menu_command`）。
pub fn build<R: Runtime, M: Manager<R>>(
    manager: &M,
    language: Language,
    theme: ThemePreference,
    language_preference: LanguagePreference,
    recent_folders: &[RecentFolderView],
) -> tauri::Result<Menu<R>> {
    let item = |command: MenuCommand| {
        MenuItem::with_id(
            manager,
            command.id(),
            label(command, language),
            true,
            accelerator_of(command),
        )
    };
    let recent_choices = recent_folders
        .iter()
        .map(|view| {
            MenuItem::with_id(
                manager,
                format!("{MENU_ITEM_PREFIX}{}", view.id),
                literal(&view.label),
                true,
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let recent_items: Vec<&dyn IsMenuItem<R>> = recent_choices
        .iter()
        .map(|item| item as &dyn IsMenuItem<R>)
        .collect();
    let recent = Submenu::with_id_and_items(
        manager,
        MenuCommand::OpenRecentFolder.id(),
        label(MenuCommand::OpenRecentFolder, language),
        !recent_folders.is_empty(),
        &recent_items,
    )?;
    let file = Submenu::with_items(
        manager,
        file_menu_label(language),
        true,
        &[
            &item(MenuCommand::OpenFolder)?,
            &recent,
            &item(MenuCommand::CloseWorkspace)?,
            &PredefinedMenuItem::separator(manager)?,
            &item(MenuCommand::CloseTab)?,
            &PredefinedMenuItem::separator(manager)?,
            &item(MenuCommand::Exit)?,
        ],
    )?;
    let theme_choices = theme::CHOICES
        .iter()
        .map(|&(command, preference)| {
            CheckMenuItem::with_id(
                manager,
                command.id(),
                label(command, language),
                true,
                preference == theme,
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let theme_items: Vec<&dyn IsMenuItem<R>> = theme_choices
        .iter()
        .map(|item| item as &dyn IsMenuItem<R>)
        .collect();
    let language_choices = language::CHOICES
        .iter()
        .map(|&(command, preference)| {
            CheckMenuItem::with_id(
                manager,
                command.id(),
                label(command, language),
                true,
                preference == language_preference,
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let language_items: Vec<&dyn IsMenuItem<R>> = language_choices
        .iter()
        .map(|item| item as &dyn IsMenuItem<R>)
        .collect();
    let view = Submenu::with_items(
        manager,
        view_menu_label(language),
        true,
        &[
            &item(MenuCommand::ToggleSidebar)?,
            &item(MenuCommand::ReloadDocument)?,
            &PredefinedMenuItem::separator(manager)?,
            &Submenu::with_items(manager, theme_menu_label(language), true, &theme_items)?,
            &Submenu::with_items(
                manager,
                language_menu_label(language),
                true,
                &language_items,
            )?,
            &PredefinedMenuItem::separator(manager)?,
            &item(MenuCommand::IncreaseFontSize)?,
            &item(MenuCommand::DecreaseFontSize)?,
            &item(MenuCommand::ResetFontSize)?,
        ],
    )?;
    let help = Submenu::with_items(
        manager,
        help_menu_label(language),
        true,
        &[&item(MenuCommand::About)?],
    )?;
    Menu::with_items(manager, &[&file, &view, &help])
}

/// 設定と状態から、いまのメニューを組み直して差し替える。
///
/// UI言語の切り替えと、最近使ったフォルダーの変化で使う。選択を反映する項目（テーマ、言語の
/// チェック）と最近使ったフォルダーの項目は、項目名だけを差し替えるより作り直すほうが、
/// 値の食い違いが起きない。組み直すのは、メニューが破棄された後（終了処理中）には失敗する
/// が、そのときは知らせる相手がいない。メインスレッドから呼ぶこと。
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    let language = app.state::<AppState>().language();
    let settings = app.state::<SettingsStore>().settings();
    let recent_folders = app.state::<RecentFolders>().views();
    if let Ok(menu) = build(
        app,
        language,
        settings.theme,
        settings.language,
        &recent_folders,
    ) {
        let _ = app.set_menu(menu);
    }
}

/// テーマの項目のチェックを、選択中の1つだけに付け直す。
///
/// チェック付きの項目は、選ばれるとmudaがチェックを反転してからイベントを送る。
/// 選択中の項目を選び直すとチェックが外れ、別の項目を選ぶと2つにチェックが付くため、
/// 選ばれるたびに3つとも付け直す。
pub fn check_theme<R: Runtime>(menu: &Menu<R>, theme: ThemePreference) -> tauri::Result<()> {
    for (command, preference) in theme::CHOICES {
        if let Some(item) = check_item(menu, command) {
            item.set_checked(preference == theme)?;
        }
    }
    Ok(())
}

/// チェック付きの項目（テーマ、言語）を引く。
pub fn check_item<R: Runtime>(menu: &Menu<R>, command: MenuCommand) -> Option<CheckMenuItem<R>> {
    find(menu.items().ok()?, &command.id())?
        .as_check_menuitem()
        .cloned()
}

/// サブメニューの中まで項目を探す。`Menu::get` と `Submenu::get` は直下しか探さない。
pub(crate) fn find<R: Runtime>(items: Vec<MenuItemKind<R>>, id: &str) -> Option<MenuItemKind<R>> {
    items.into_iter().find_map(|item| {
        if item.id().as_ref() == id {
            return Some(item);
        }
        find(item.as_submenu()?.items().ok()?, id)
    })
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
        let menu = build(
            app.handle(),
            Language::Ja,
            ThemePreference::System,
            LanguagePreference::System,
            &[],
        )
        .expect("メニューを組み立てられない");
        let contains = |command: MenuCommand| {
            find(
                menu.items().expect("メニューの項目を取れない"),
                &command.id(),
            )
            .is_some()
        };

        for command in IMPLEMENTED {
            assert!(contains(command), "{command:?} が無い");
        }
    }

    fn recent_view(id: &str, label: &str) -> RecentFolderView {
        RecentFolderView {
            id: id.to_owned(),
            label: label.to_owned(),
        }
    }

    fn recent_submenu(menu: &Menu<tauri::test::MockRuntime>) -> Submenu<tauri::test::MockRuntime> {
        find(
            menu.items().expect("メニューの項目を取れない"),
            &MenuCommand::OpenRecentFolder.id(),
        )
        .and_then(|item| item.as_submenu().cloned())
        .expect("最近使ったフォルダーのサブメニューが無い")
    }

    /// 最近使ったフォルダーは、一覧の並びのまま項目になる。項目のIDは、一覧のIDに
    /// `MENU_ITEM_PREFIX` を前置きしたものである。
    #[test]
    fn recent_folders_become_items_in_order() {
        let app = tauri::test::mock_app();
        let views = [
            recent_view("recent-1-0", "dev\\docs"),
            recent_view("recent-1-1", "D:\\notes"),
        ];
        let menu = build(
            app.handle(),
            Language::Ja,
            ThemePreference::System,
            LanguagePreference::System,
            &views,
        )
        .expect("メニューを組み立てられない");

        let submenu = recent_submenu(&menu);

        assert!(submenu.is_enabled().unwrap());
        let items = submenu.items().unwrap();
        assert_eq!(
            items
                .iter()
                .map(|item| item.id().as_ref().to_owned())
                .collect::<Vec<_>>(),
            [
                format!("{MENU_ITEM_PREFIX}recent-1-0"),
                format!("{MENU_ITEM_PREFIX}recent-1-1"),
            ]
        );
        assert_eq!(
            items
                .iter()
                .map(|item| item.as_menuitem().unwrap().text().unwrap())
                .collect::<Vec<_>>(),
            ["dev\\docs", "D:\\notes"]
        );
    }

    /// 一覧が空のときは、項目を持たない無効なサブメニューにする。
    #[test]
    fn the_recent_folders_submenu_is_disabled_when_empty() {
        let app = tauri::test::mock_app();
        let menu = build(
            app.handle(),
            Language::Ja,
            ThemePreference::System,
            LanguagePreference::System,
            &[],
        )
        .expect("メニューを組み立てられない");

        let submenu = recent_submenu(&menu);

        assert!(!submenu.is_enabled().unwrap());
        assert!(submenu.items().unwrap().is_empty());
    }

    /// フォルダー名の `&` は、アクセスキーの印ではなく文字として表示する。
    #[test]
    fn an_ampersand_in_a_folder_name_is_displayed_literally() {
        assert_eq!(literal("R&D\\notes"), "R&&D\\notes");
        assert_eq!(literal("docs"), "docs");
    }

    /// 保存済みのテーマの項目だけにチェックが付いた状態で組み立てる。
    #[test]
    fn the_saved_theme_is_checked() {
        for (_, saved) in theme::CHOICES {
            let app = tauri::test::mock_app();
            let menu = build(
                app.handle(),
                Language::Ja,
                saved,
                LanguagePreference::System,
                &[],
            )
            .expect("メニューを組み立てられない");

            for (command, preference) in theme::CHOICES {
                let item = check_item(&menu, command).expect("テーマの項目が無い");
                assert_eq!(
                    item.is_checked().unwrap(),
                    preference == saved,
                    "保存値 {saved:?} の {command:?}"
                );
            }
        }
    }

    /// 保存済みの言語の選択の項目だけにチェックが付いた状態で組み立てる。
    #[test]
    fn the_saved_language_preference_is_checked() {
        for (_, saved) in language::CHOICES {
            let app = tauri::test::mock_app();
            let menu = build(
                app.handle(),
                Language::Ja,
                ThemePreference::System,
                saved,
                &[],
            )
            .expect("メニューを組み立てられない");

            for (command, preference) in language::CHOICES {
                let item = check_item(&menu, command).expect("言語の項目が無い");
                assert_eq!(
                    item.is_checked().unwrap(),
                    preference == saved,
                    "保存値 {saved:?} の {command:?}"
                );
            }
        }
    }

    /// 言語の名前は、現在のUI言語によらず、その言語で書く。
    #[test]
    fn language_names_are_written_in_their_own_language() {
        for ui in [Language::Ja, Language::En] {
            assert_eq!(label(MenuCommand::UseJapanese, ui), "日本語(&J)");
            assert_eq!(label(MenuCommand::UseEnglish, ui), "English(&E)");
        }
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
