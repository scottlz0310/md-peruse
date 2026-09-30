pub mod drag_drop;
pub mod drop;
pub mod file_kind;
pub mod i18n;
pub mod image;
pub mod ipc;
pub mod language;
pub mod launch;
pub mod limits;
pub mod menu;
pub mod menu_command;
pub mod natural_order;
pub mod open_document;
pub mod open_folder;
pub mod path_guard;
pub mod read;
pub mod recent;
pub mod scan;
pub mod settings;
pub mod settings_store;
pub mod startup;
pub mod startup_failure;
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
use telemetry::Telemetry;

use tauri::{Manager, RunEvent, WebviewWindowBuilder};

pub fn run() {
    // `env::args` は、Unicodeでない引数で異常終了するため使わない。
    let argv: Vec<String> = std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let launched_by_association = launch::launched_by_association(&argv);
    let app = image::protocol::register(tauri::Builder::default())
        // 関連付け起動の受け口。他のプラグインより先に登録する（プラグインの要件）。2つ目の
        // プロセスは引数を渡して終了し、ここへ届く（design-decisions.md 9.2）。
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            launch::second_instance(app, argv, cwd);
        }))
        // プラグインは起動処理より先に引数を届けうるため、保留は他の状態に依存させず、
        // ここで登録する。起動引数のファイルも、ここで保留へ入れる。復元とFrontendの準備が
        // 済むまで開かれず、先に届いた2つ目のプロセスの引数に追い越されない（`launch` の
        // モジュール文書）。
        .manage(launch::LaunchQueue::started_with(&argv))
        .plugin(tauri_plugin_opener::init())
        // Rust側からだけ使う。capabilityへdialogの権限を加えないため、Frontendからは
        // 呼べない（design-decisions.md 5.5）。
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(menu_command::handle_menu_event)
        .setup(move |app| {
            setup(app, launched_by_association)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::commands::close_loose_scope_command,
            ipc::commands::frontend_ready_command,
            ipc::commands::get_ui_settings_command,
            ipc::commands::get_workspace_command,
            ipc::commands::issue_image_resources_command,
            ipc::commands::open_recent_folder_command,
            ipc::commands::read_file_command,
            ipc::commands::report_open_result_command,
            ipc::commands::scan_directory_command,
            ipc::commands::update_ui_settings_command,
            ipc::commands::watch_loose_document_command
        ])
        .build(tauri::generate_context!())
        .expect("Tauriアプリケーションの起動に失敗しました");
    app.run(|app, event| match event {
        // 終了の要求の時点では、ウィンドウがまだある。動きが落ち着くのを待つ配置の保存が間に合わない
        // うちに終了しても、最後の配置を書き出せるよう、ここで確定する（11.1）。
        RunEvent::ExitRequested { .. } => window_placement::capture_now(app),
        // 変更をまとめて待っている書込みを、終了の前に書き出す（design-decisions.md 11.1）。
        RunEvent::Exit => app.state::<SettingsStore>().flush(),
        _ => {}
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
fn setup(app: &mut tauri::App, launched_by_association: bool) -> tauri::Result<()> {
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
    // Store向けカスタムイベントのうち、プロセスの起動で記録するもの（11.4）。
    app.manage(Telemetry::for_this_process());
    app.state::<Telemetry>()
        .record_process_start(launched_by_association);

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
    //
    // WebView2 Runtimeの欠落や初期化の失敗は、ウィンドウを作るとき、またはそのWebViewを扱う
    // ときに分かる。`setup` の失敗はTauriがpanicにして、ウィンドウも文言も無いまま異常終了する
    // ため、返さずに、原因を示して終了する（spec.md 4.4、design-decisions.md 12章）。
    let window = WebviewWindowBuilder::from_config(app.handle(), &config)?
        .theme(theme::window_theme(settings.theme))
        .visible(restored.is_none())
        .build()
        .unwrap_or_else(|error| startup_failure::exit_after_report(language, &error));
    if let Some(placement) = restored {
        window_placement::apply(&window, placement)?;
    }
    webview_keys::attach(&window)
        .unwrap_or_else(|error| startup_failure::exit_after_report(language, &error));
    window_placement::track(&window);
    drag_drop::track(&window);

    let restore_handle = app.handle().clone();
    thread::spawn(move || {
        open_folder::restore_last_workspace(&restore_handle, || {
            launch::restore_may_commit(&restore_handle)
        });
        launch::restored(&restore_handle);
    });
    // 起動引数のファイルが復元を待つ間の上限（9.2）。
    launch::limit_restore_wait(app.handle(), launch::RESTORE_WAIT_LIMIT);

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
