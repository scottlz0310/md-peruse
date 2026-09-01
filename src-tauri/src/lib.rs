pub mod ipc;
pub mod limits;
pub mod settings;
pub mod watch;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("Tauriアプリケーションの起動に失敗しました");
}
