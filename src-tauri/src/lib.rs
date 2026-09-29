pub mod drop;
pub mod file_kind;
pub mod i18n;
pub mod image;
pub mod ipc;
pub mod language;
pub mod limits;
pub mod menu;
pub mod menu_command;
pub mod natural_order;
pub mod open_folder;
pub mod path_guard;
pub mod read;
pub mod recent;
pub mod scan;
pub mod settings;
pub mod settings_store;
pub mod startup;
pub mod state;
pub mod telemetry;
pub mod theme;
pub mod watch;
pub mod watch_runtime;
pub mod webview_keys;
pub mod window_placement;

use ipc::error::ErrorCode;
use recent::RecentFolders;
use settings_store::{LoadOutcome, SettingsStore};
use state::AppState;
use std::thread;

use tauri::{Manager, RunEvent, WebviewWindowBuilder};

pub fn run() {
    let app = image::protocol::register(tauri::Builder::default())
        .plugin(tauri_plugin_opener::init())
        // Rust側からだけ使う。capabilityへdialogの権限を加えないため、Frontendからは
        // 呼べない（design-decisions.md 5.5）。
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(menu_command::handle_menu_event)
        .setup(|app| {
            setup(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::commands::get_ui_settings_command,
            ipc::commands::get_workspace_command,
            ipc::commands::issue_image_resources_command,
            ipc::commands::open_recent_folder_command,
            ipc::commands::read_file_command,
            ipc::commands::scan_directory_command,
            ipc::commands::update_ui_settings_command
        ])
        .build(tauri::generate_context!())
        .expect("Tauriアプリケーションの起動に失敗しました");
    app.run(|app, event| {
        // 変更をまとめて待っている書込みを、終了の前に書き出す（design-decisions.md 11.1）。
        if let RunEvent::Exit = event {
            app.state::<SettingsStore>().flush();
        }
    });
}

/// 設定を読み、状態・メニュー・ウィンドウをこの順に作る。
///
/// メインウィンドウは `tauri.conf.json` で自動生成せず（`create: false`）、ここで作る。
/// 自動生成するとsetupより前にWebViewが読み込まれ、状態を登録する前にcommandが呼ばれうる。
/// メニューもUI言語と最近使ったフォルダーが設定から決まるため、設定を読んだ後に組み立てる。
/// ウィンドウの配置も設定から決まるため、作るときに適用する。
///
/// 最後のワークスペースは、ウィンドウを作ったあとに別のスレッドで開き直す。応答の遅い
/// ストレージで、ウィンドウの表示を待たせないためである（9.2）。
fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let handle = app.handle().clone();
    let (store, outcome) = SettingsStore::open(
        app.path().app_config_dir()?,
        // 書込みの失敗は別スレッドで起きるため、呼び出し元へ返せない。操作は続けられるので、
        // 保存されないことをダイアログで知らせる。ネイティブ絶対パスを含みうる `io::Error`
        // の内容は表示しない（7.1）。
        Box::new(move |_| open_folder::show_error(&handle, &[ErrorCode::SettingsSaveFailed])),
    );
    let settings = store.settings();
    let recents = RecentFolders::new();
    recents.sync(&settings.recent_folders);
    let recent_folders = recents.views();
    app.manage(AppState::new(settings.language));
    app.manage(recents);
    app.manage(store);

    let language = app.state::<AppState>().language();
    app.set_menu(menu::build(
        app.handle(),
        language,
        settings.theme,
        settings.language,
        &recent_folders,
    )?)?;

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == open_folder::MAIN_WINDOW)
        .expect("メインウィンドウは tauri.conf.json で定義する")
        .clone();
    let restored = window_placement::placement_to_restore(app.handle(), settings.window);
    // 作った後にテーマを切り替えると、起動直後に別の配色が一瞬見える。配置も同じで、
    // 復元するときは非表示で作り、配置してから表示する。
    let window = WebviewWindowBuilder::from_config(app.handle(), &config)?
        .theme(theme::window_theme(settings.theme))
        .visible(restored.is_none())
        .build()?;
    if let Some(placement) = restored {
        window_placement::apply(&window, placement)?;
    }
    webview_keys::attach(&window)?;
    window_placement::track(&window);

    let restore_handle = app.handle().clone();
    thread::spawn(move || open_folder::restore_last_workspace(&restore_handle));

    let notice: &[ErrorCode] = match outcome {
        LoadOutcome::Loaded => &[],
        LoadOutcome::ResetAfterBackup => &[ErrorCode::SettingsCorrupted],
        LoadOutcome::ResetWithoutSaving => {
            &[ErrorCode::SettingsCorrupted, ErrorCode::SettingsSaveFailed]
        }
    };
    if !notice.is_empty() {
        open_folder::show_error(app.handle(), notice);
    }
    Ok(())
}
