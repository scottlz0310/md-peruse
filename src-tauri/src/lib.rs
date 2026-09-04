pub mod drop;
pub mod file_kind;
pub mod i18n;
pub mod ipc;
pub mod limits;
pub mod menu;
pub mod natural_order;
pub mod path_guard;
pub mod scan;
pub mod settings;
pub mod startup;
pub mod state;
pub mod telemetry;
pub mod watch;

use i18n::LanguagePreference;
use state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // 設定の読み込み（design-decisions.md 11.1）はPhase 4で別に実装する。
        // それまでUI言語の設定値は既定の `System` とする。
        .manage(AppState::new(LanguagePreference::default()))
        .invoke_handler(tauri::generate_handler![
            ipc::commands::scan_directory_command
        ])
        .run(tauri::generate_context!())
        .expect("Tauriアプリケーションの起動に失敗しました");
}
