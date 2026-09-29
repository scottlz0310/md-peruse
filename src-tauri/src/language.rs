//! UI表示言語の切り替え（design-decisions.md 10.1、10.5）。
//!
//! 言語はネイティブメニューとネイティブダイアログの文言を変える。メニューの項目名そのものを
//! 組み直す必要があるため、切り替えはRust側が処理する。WebView内の文言は
//! `language-changed` eventで知らせる。

use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::i18n::{LanguagePreference, os_language_tag, resolve_language};
use crate::ipc::types::LanguageChangedEvent;
use crate::menu::{self, MenuCommand};
use crate::settings_store::SettingsStore;
use crate::state::AppState;

/// UI言語の切り替えを運ぶTauri eventの名前。
pub const LANGUAGE_CHANGED_EVENT: &str = "language-changed";

/// 言語のメニュー項目と、それが表す設定値。メニューの並び順でもある。
pub const CHOICES: [(MenuCommand, LanguagePreference); 3] = [
    (MenuCommand::UseSystemLanguage, LanguagePreference::System),
    (MenuCommand::UseJapanese, LanguagePreference::Ja),
    (MenuCommand::UseEnglish, LanguagePreference::En),
];

/// メニューで選ばれた言語を保存して適用する。言語の項目以外のコマンドは無視する。
pub fn select<R: Runtime>(app: &AppHandle<R>, command: MenuCommand) {
    select_with(app, command, &os_language_tag());
}

/// `select` の本体。OSの表示言語を差し替えられるのは、テストがOSの設定に依存しないためである。
///
/// 保存、`AppState` の言語、メニューの組み直し、eventの送出の順に行う。`system` を選んだときも、
/// その時点のOSの表示言語で決め直す。OSの表示言語そのものは監視しないため、eventが飛ぶのは
/// メニューから選んだときだけである。
fn select_with<R: Runtime>(app: &AppHandle<R>, command: MenuCommand, os_language_tag: &str) {
    let Some(&(_, preference)) = CHOICES.iter().find(|(candidate, _)| *candidate == command) else {
        return;
    };
    let store = app.state::<SettingsStore>();
    store.set_language(preference);
    let language = resolve_language(preference, os_language_tag);
    app.state::<AppState>().set_language(language);
    // チェック付きの項目は、選ばれるとmudaがチェックを反転してからイベントを送る。組み直せば、
    // チェックも新しい選択に揃う。失敗するのはメニューが破棄された後（終了処理中）であり、
    // 知らせる相手がいない。
    if let Ok(menu) = menu::build(app, language, store.settings().theme, preference) {
        let _ = app.set_menu(menu);
    }
    let _ = app.emit(
        LANGUAGE_CHANGED_EVENT,
        LanguageChangedEvent {
            preference,
            language,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::Language;
    use crate::settings::{Settings, ThemePreference};
    use std::sync::{Arc, Mutex};
    use tauri::Listener;

    /// 選んだ言語を、状態、設定、メニュー、eventのすべてへ反映する。
    ///
    /// OSの表示言語を日本語にして、`system` が日本語へ決まることも確かめる。
    #[test]
    fn selecting_updates_the_state_the_settings_the_menu_and_the_event() {
        let cases = [
            (
                MenuCommand::UseSystemLanguage,
                LanguagePreference::System,
                Language::Ja,
            ),
            (
                MenuCommand::UseJapanese,
                LanguagePreference::Ja,
                Language::Ja,
            ),
            (
                MenuCommand::UseEnglish,
                LanguagePreference::En,
                Language::En,
            ),
        ];
        for (command, preference, language) in cases {
            let app = tauri::test::mock_app();
            // 起動時と逆の言語から始める。
            let initial = if language == Language::Ja {
                LanguagePreference::En
            } else {
                LanguagePreference::Ja
            };
            app.manage(SettingsStore::without_saving(Settings {
                language: initial,
                theme: ThemePreference::Dark,
                ..Settings::default()
            }));
            app.manage(AppState::new(initial));
            let events = Arc::new(Mutex::new(Vec::new()));
            let sink = Arc::clone(&events);
            app.listen(LANGUAGE_CHANGED_EVENT, move |event| {
                sink.lock().unwrap().push(event.payload().to_owned());
            });

            select_with(app.handle(), command, "ja-JP");

            assert_eq!(app.state::<AppState>().language(), language, "{command:?}");
            assert_eq!(
                app.state::<SettingsStore>().settings().language,
                preference,
                "{command:?}"
            );
            let menu = app.menu().expect("メニューが組み直されていない");
            let checked: Vec<_> = CHOICES
                .iter()
                .filter(|(candidate, _)| {
                    menu::check_item(&menu, *candidate)
                        .expect("言語の項目が無い")
                        .is_checked()
                        .unwrap()
                })
                .map(|(_, checked)| *checked)
                .collect();
            assert_eq!(checked, [preference], "{command:?}");
            // 保存済みのテーマは組み直しても失わない。
            let theme_item =
                menu::check_item(&menu, MenuCommand::UseDarkTheme).expect("テーマの項目が無い");
            assert!(theme_item.is_checked().unwrap(), "{command:?}");
            let expected = serde_json::to_string(&LanguageChangedEvent {
                preference,
                language,
            })
            .unwrap();
            assert_eq!(*events.lock().unwrap(), [expected], "{command:?}");
        }
    }

    /// 組み直したメニューは、新しい言語の項目名になる。
    #[test]
    fn the_menu_is_rebuilt_in_the_new_language() {
        let app = tauri::test::mock_app();
        app.manage(SettingsStore::without_saving(Settings::default()));
        app.manage(AppState::new(LanguagePreference::Ja));

        select_with(app.handle(), MenuCommand::UseEnglish, "ja-JP");

        let menu = app.menu().expect("メニューが組み直されていない");
        let titles: Vec<_> = menu
            .items()
            .unwrap()
            .into_iter()
            .map(|item| item.as_submenu().unwrap().text().unwrap())
            .collect();
        assert_eq!(titles, ["&File", "&View"]);
    }

    /// `system` はその時点のOSの表示言語で決め直す。英語以外は英語へ倒れる。
    #[test]
    fn system_follows_the_os_language_at_the_time_of_selection() {
        let cases = [
            ("ja-JP", Language::Ja),
            ("en-US", Language::En),
            ("fr-FR", Language::En),
        ];
        for (tag, expected) in cases {
            let app = tauri::test::mock_app();
            app.manage(SettingsStore::without_saving(Settings::default()));
            app.manage(AppState::new(LanguagePreference::En));

            select_with(app.handle(), MenuCommand::UseSystemLanguage, tag);

            assert_eq!(app.state::<AppState>().language(), expected, "{tag}");
        }
    }

    /// 言語以外のコマンドでは、何も変えず、eventも送らない。
    #[test]
    fn other_commands_are_ignored() {
        let app = tauri::test::mock_app();
        app.manage(SettingsStore::without_saving(Settings {
            language: LanguagePreference::Ja,
            ..Settings::default()
        }));
        app.manage(AppState::new(LanguagePreference::Ja));
        let count = Arc::new(Mutex::new(0));
        let sink = Arc::clone(&count);
        app.listen(LANGUAGE_CHANGED_EVENT, move |_| *sink.lock().unwrap() += 1);

        select_with(app.handle(), MenuCommand::ToggleSidebar, "en-US");

        assert_eq!(app.state::<AppState>().language(), Language::Ja);
        assert_eq!(
            app.state::<SettingsStore>().settings().language,
            LanguagePreference::Ja
        );
        assert_eq!(*count.lock().unwrap(), 0);
        assert!(app.menu().is_none());
    }
}
