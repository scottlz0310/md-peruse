//! 配色テーマの切り替え（design-decisions.md 10.1）。
//!
//! テーマはウィンドウへ適用する。WebView2の `prefers-color-scheme` はウィンドウの
//! テーマに従うため、本文のCSS、コードハイライト、Mermaidの図はFrontendで値を
//! 受け取らずに追従する（実測）。

use tauri::{AppHandle, Manager, Runtime, Theme};

use crate::menu::{self, MenuCommand};
use crate::open_folder::MAIN_WINDOW;
use crate::settings::ThemePreference;
use crate::settings_store::SettingsStore;

/// テーマのメニュー項目と、それが表す設定値。メニューの並び順でもある。
pub const CHOICES: [(MenuCommand, ThemePreference); 3] = [
    (MenuCommand::UseSystemTheme, ThemePreference::System),
    (MenuCommand::UseLightTheme, ThemePreference::Light),
    (MenuCommand::UseDarkTheme, ThemePreference::Dark),
];

/// ウィンドウへ渡すテーマ。`System` は `None` とし、OSの設定に従わせる。
pub fn window_theme(preference: ThemePreference) -> Option<Theme> {
    match preference {
        ThemePreference::System => None,
        ThemePreference::Light => Some(Theme::Light),
        ThemePreference::Dark => Some(Theme::Dark),
    }
}

/// メニューで選ばれたテーマを保存して適用する。テーマの項目以外のコマンドは無視する。
pub fn select<R: Runtime>(app: &AppHandle<R>, command: MenuCommand) {
    select_with(app, command, |theme| apply(app, theme));
}

/// `select` の本体。適用を差し替えられるのは、`tauri::test` のモックがアプリ全体の
/// `set_theme` を実装しておらず（`unimplemented!`）、テストから呼べないためである。
fn select_with<R: Runtime>(
    app: &AppHandle<R>,
    command: MenuCommand,
    apply: impl FnOnce(Option<Theme>) -> tauri::Result<()>,
) {
    let Some(&(_, preference)) = CHOICES.iter().find(|(candidate, _)| *candidate == command) else {
        return;
    };
    app.state::<SettingsStore>().set_theme(preference);
    // 失敗するのはウィンドウやメニューが破棄された後（終了処理中）であり、知らせる相手がいない。
    let _ = apply(window_theme(preference));
    if let Some(menu) = app.menu() {
        let _ = menu::check_theme(&menu, preference);
    }
}

fn apply<R: Runtime>(app: &AppHandle<R>, theme: Option<Theme>) -> tauri::Result<()> {
    // 起動時にウィンドウへ渡したテーマは、アプリ全体の指定より優先される（tao）。
    // そのためウィンドウの指定を置き換える。アプリ全体の指定は、メニューバーの配色を
    // 変えるために要る。ウィンドウの指定だけではメニューバーが起動時の配色に残る。
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.set_theme(theme)?;
    }
    app.set_theme(theme);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::{Language, LanguagePreference};
    use crate::settings::Settings;

    #[test]
    fn preferences_map_to_window_themes() {
        let cases = [
            (ThemePreference::System, None),
            (ThemePreference::Light, Some(Theme::Light)),
            (ThemePreference::Dark, Some(Theme::Dark)),
        ];
        for (preference, expected) in cases {
            assert_eq!(window_theme(preference), expected, "{preference:?}");
        }
    }

    /// 選んだテーマを保存して適用し、その項目だけにチェックを付け直す。
    ///
    /// mudaは選択時にチェックを反転してからイベントを送る。その状態を再現してから選ぶ。
    /// 保存済みの `System` を選び直す場合はチェックが外れた状態から、ほかを選ぶ場合は
    /// 2つにチェックが付いた状態から始まる。
    #[test]
    fn selecting_saves_applies_and_moves_the_check() {
        for (command, preference) in CHOICES {
            let app = tauri::test::mock_app();
            app.manage(SettingsStore::without_saving(Settings::default()));
            let built = menu::build(
                app.handle(),
                Language::Ja,
                ThemePreference::System,
                LanguagePreference::System,
                &[],
            )
            .expect("メニューを組み立てられない");
            app.set_menu(built).expect("メニューを設定できない");
            let menu = app.menu().expect("メニューが無い");
            let item = menu::check_item(&menu, command).expect("テーマの項目が無い");
            item.set_checked(!item.is_checked().unwrap()).unwrap();
            let mut applied = Vec::new();

            select_with(app.handle(), command, |theme| {
                applied.push(theme);
                Ok(())
            });

            assert_eq!(
                app.state::<SettingsStore>().settings().theme,
                preference,
                "{command:?}"
            );
            assert_eq!(applied, [window_theme(preference)], "{command:?}");
            let checked: Vec<_> = CHOICES
                .iter()
                .filter(|(candidate, _)| {
                    menu::check_item(&menu, *candidate)
                        .expect("テーマの項目が無い")
                        .is_checked()
                        .unwrap()
                })
                .map(|(_, checked)| *checked)
                .collect();
            assert_eq!(checked, [preference], "{command:?}");
        }
    }

    /// テーマ以外のコマンドでは保存も適用もしない。
    #[test]
    fn other_commands_are_ignored() {
        let app = tauri::test::mock_app();
        let saved = Settings {
            theme: ThemePreference::Dark,
            ..Settings::default()
        };
        app.manage(SettingsStore::without_saving(saved));
        let mut applied = Vec::new();

        select_with(app.handle(), MenuCommand::ToggleSidebar, |theme| {
            applied.push(theme);
            Ok(())
        });

        assert_eq!(
            app.state::<SettingsStore>().settings().theme,
            ThemePreference::Dark
        );
        assert!(applied.is_empty());
    }
}
