//! メニューコマンドの振り分け（design-decisions.md 10.1）。
//!
//! メニューの選択と、WebViewにフォーカスがあるときのアクセラレータ（`crate::webview_keys`）
//! は同じコマンドへ集まる。ここで10.1の表の「処理する側」に従って振り分け、Rust側で処理する
//! ものは担当のモジュールへ渡し、Frontendが処理するものはeventで送る。

use tauri::menu::MenuEvent;
use tauri::{AppHandle, Emitter, Runtime};

use crate::language;
use crate::menu::MenuCommand;
use crate::open_folder;
use crate::recent;
use crate::theme;

/// Frontendが処理するメニューコマンドを運ぶTauri eventの名前。
pub const MENU_COMMAND_EVENT: &str = "menu-command";

/// メニューの選択を処理する。
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    // 最近使ったフォルダーの項目は、項目ごとにIDが違う。コマンドの識別子としては引けない。
    if let Some(recent_id) = id.strip_prefix(recent::MENU_ITEM_PREFIX) {
        recent::open_from_menu(app, recent_id);
        return;
    }
    // アプリが作っていない項目は、選ばれることがない。
    if let Some(command) = MenuCommand::from_id(id) {
        handle_command(app, command);
    }
}

/// コマンドを処理する。メニューの選択と、WebViewにフォーカスがあるときのアクセラレータ
/// （`crate::webview_keys`）の両方から呼ばれる。
pub fn handle_command<R: Runtime>(app: &AppHandle<R>, command: MenuCommand) {
    match command {
        MenuCommand::OpenFolder => open_folder::pick_and_open(app),
        // 閉じ終わりは待たない。完了は `workspace-closed` で知らせる。
        MenuCommand::CloseWorkspace => {
            open_folder::close(app);
        }
        MenuCommand::Exit => app.exit(0),
        MenuCommand::UseSystemTheme | MenuCommand::UseLightTheme | MenuCommand::UseDarkTheme => {
            theme::select(app, command)
        }
        MenuCommand::UseSystemLanguage | MenuCommand::UseJapanese | MenuCommand::UseEnglish => {
            language::select(app, command)
        }
        MenuCommand::CloseTab
        | MenuCommand::ToggleSidebar
        | MenuCommand::ReloadDocument
        | MenuCommand::IncreaseFontSize
        | MenuCommand::DecreaseFontSize
        | MenuCommand::ResetFontSize
        | MenuCommand::About
        | MenuCommand::UserGuide => forward(app, command),
        // サブメニューそのものは選ばれない。その項目は `handle_menu_event` が別に扱う。
        MenuCommand::OpenRecentFolder => {}
    }
}

/// Frontendが処理するコマンドをeventで送る。
///
/// 送出の失敗は受け手（WebView）がいないときであり、伝える相手がいない。
fn forward<R: Runtime>(app: &AppHandle<R>, command: MenuCommand) {
    let _ = app.emit(MENU_COMMAND_EVENT, command);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::LanguagePreference;
    use crate::settings::Settings;
    use crate::settings_store::SettingsStore;
    use crate::state::AppState;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use tauri::{Listener, Manager};

    /// Frontend担当のコマンドは、識別子をそのままeventで届ける。
    #[test]
    fn frontend_commands_are_forwarded_as_events() {
        let cases = [
            (MenuCommand::CloseTab, "\"closeTab\""),
            (MenuCommand::ToggleSidebar, "\"toggleSidebar\""),
            (MenuCommand::ReloadDocument, "\"reloadDocument\""),
            (MenuCommand::IncreaseFontSize, "\"increaseFontSize\""),
            (MenuCommand::DecreaseFontSize, "\"decreaseFontSize\""),
            (MenuCommand::ResetFontSize, "\"resetFontSize\""),
            (MenuCommand::About, "\"about\""),
            (MenuCommand::UserGuide, "\"userGuide\""),
        ];
        for (command, expected) in cases {
            let app = tauri::test::mock_app();
            let payloads = Arc::new(Mutex::new(Vec::new()));
            let seen = Arc::clone(&payloads);
            app.listen(MENU_COMMAND_EVENT, move |event| {
                seen.lock().unwrap().push(event.payload().to_owned());
            });

            handle_command(app.handle(), command);

            assert_eq!(*payloads.lock().unwrap(), [expected], "{command:?}");
        }
    }

    /// Rust側で処理するコマンドと、メニューへ載せていないコマンドはeventを送らない。
    #[test]
    fn other_commands_are_not_forwarded() {
        for command in [MenuCommand::CloseWorkspace, MenuCommand::OpenRecentFolder] {
            let app = tauri::test::mock_app();
            app.manage(AppState::new(LanguagePreference::System));
            // ワークスペースを閉じる処理が、最後のワークスペースを消すために使う。
            app.manage(SettingsStore::without_saving(Settings::default()));
            let received = Arc::new(AtomicUsize::new(0));
            let seen = Arc::clone(&received);
            app.listen(MENU_COMMAND_EVENT, move |_| {
                seen.fetch_add(1, Ordering::SeqCst);
            });

            handle_command(app.handle(), command);

            assert_eq!(received.load(Ordering::SeqCst), 0, "{command:?}");
        }
    }
}
