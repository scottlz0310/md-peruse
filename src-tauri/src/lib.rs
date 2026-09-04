pub mod drop;
pub mod file_kind;
pub mod i18n;
pub mod ipc;
pub mod limits;
pub mod menu;
pub mod path_guard;
pub mod settings;
pub mod startup;
pub mod telemetry;
pub mod watch;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("Tauriアプリケーションの起動に失敗しました");
}
