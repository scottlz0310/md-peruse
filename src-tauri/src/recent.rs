//! 最近使ったフォルダー（design-decisions.md 9.2、11.1）。
//!
//! 設定へ保存するのは絶対パスの一覧だけであり、ここはその一覧に不透明なIDを振る。メニューの
//! 項目とFrontendの一覧が同じIDで「このフォルダーを開く」ことを求め、Rust側が対応表から
//! 絶対パスへ戻す。Frontendへ絶対パスを渡さないための間接参照である（7.1）。
//!
//! IDは一覧を作り直すたびに振り直す。以前の一覧のIDは拒否され、古い一覧を見ている
//! 側が別のフォルダーを開いてしまうことがない。IDの値に意味は持たせない。

use std::path::Path;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;

use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::ipc::error::ErrorCode;
use crate::menu;
use crate::open_folder;
use crate::settings::{RecentFolderView, RecentFoldersChangedEvent, recent_folder_label};
use crate::settings_store::SettingsStore;

/// 最近使ったフォルダーの一覧が変わったことを運ぶTauri eventの名前。
pub const RECENT_FOLDERS_CHANGED_EVENT: &str = "recent-folders-changed";

/// 最近使ったフォルダーのメニュー項目のIDの前置き。後ろへ、対応表のIDを続ける。
///
/// 項目ごとにIDを分けるため、`MenuCommand` の識別子とは別に扱う（`crate::menu_command`）。
pub const MENU_ITEM_PREFIX: &str = "openRecentFolder:";

struct Entry {
    id: String,
    path: String,
    label: String,
}

/// 最近使ったフォルダーのIDの対応表。Tauriのmanaged stateとして登録する。
///
/// 対応表は実行時の状態であり、設定ファイルへは保存しない。
#[derive(Default)]
pub struct RecentFolders {
    entries: Mutex<Vec<Entry>>,
    /// 一覧を作り直した回数。IDへ含め、以前の一覧のIDを拒否できるようにする。
    generation: AtomicU64,
}

impl RecentFolders {
    pub fn new() -> Self {
        Self::default()
    }

    /// 設定の一覧（新しいものが先頭）から対応表を作り直す。IDはすべて振り直す。
    pub fn sync(&self, paths: &[String]) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let entries = paths
            .iter()
            .enumerate()
            .map(|(index, path)| Entry {
                id: format!("recent-{generation}-{index}"),
                path: path.clone(),
                label: recent_folder_label(path),
            })
            .collect();
        *self.lock() = entries;
    }

    /// Frontendとメニューへ渡す一覧。絶対パスは含まない。
    pub fn views(&self) -> Vec<RecentFolderView> {
        self.lock()
            .iter()
            .map(|entry| RecentFolderView {
                id: entry.id.clone(),
                label: entry.label.clone(),
            })
            .collect()
    }

    /// IDに対応する絶対パス。未知のIDと、作り直す前の一覧のIDには `None` を返す。
    pub fn resolve(&self, id: &str) -> Option<String> {
        self.lock()
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.path.clone())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<Entry>> {
        // ロックが毒された時点で状態の一貫性は失われている。`panic = "abort"` の下では
        // 毒される経路自体が生じないため、回復は試みない（12章）。
        self.entries
            .lock()
            .expect("最近使ったフォルダーのロックに失敗")
    }
}

/// 設定の一覧が変わったあとに、対応表、メニュー、Frontendへ反映する。
///
/// メニューはメインスレッドで組み直す。開く処理は別のスレッドから呼ばれるため、そこで
/// メニューを直接触らない。
pub fn publish<R: Runtime>(app: &AppHandle<R>) {
    let recents = app.state::<RecentFolders>();
    recents.sync(&app.state::<SettingsStore>().settings().recent_folders);
    let menu_app = app.clone();
    // 失敗するのはイベントループが終わった後（終了処理中）であり、伝える相手がいない。
    let _ = app.run_on_main_thread(move || menu::refresh(&menu_app));
    // 送出の失敗は受け手（WebView）がいないときであり、伝える相手がいない。
    let _ = app.emit(
        RECENT_FOLDERS_CHANGED_EVENT,
        RecentFoldersChangedEvent {
            folders: recents.views(),
        },
    );
}

/// ワークスペースを開いたことを記録する。`path` は `WorkspaceRoot::path` の正規化済みパス。
pub fn record_opened<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    app.state::<SettingsStore>()
        .record_opened_workspace(&path.to_string_lossy());
    publish(app);
}

/// 開けなかったフォルダーを、最近使ったフォルダーと最後のワークスペースから取り除く。
pub fn forget<R: Runtime>(app: &AppHandle<R>, path: &str) {
    app.state::<SettingsStore>().forget_workspace(path);
    publish(app);
}

/// 一覧の項目をワークスペースとして開く。
///
/// 未知のIDは `RecentFolderNotFound` で拒否する。一覧を取り直せば解消する失敗であり、
/// フォルダー自体が移動または削除された `WorkspaceNotFound` とは分ける（11.1）。後者は、
/// 開けない項目を残しても取れる行動がないため、一覧から取り除く。
pub fn open<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<(), ErrorCode> {
    let path = app
        .state::<RecentFolders>()
        .resolve(id)
        .ok_or(ErrorCode::RecentFolderNotFound)?;
    let result = open_folder::open_path(app, Path::new(&path));
    if result == Err(ErrorCode::WorkspaceNotFound) {
        forget(app, &path);
    }
    result
}

/// メニューで選ばれた項目を開く。失敗はネイティブダイアログで示す（12章）。
///
/// メニューの処理はメインスレッドで呼ばれる。フォルダーを開くときのI/Oで待たないよう、
/// 別のスレッドで開く。
pub fn open_from_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let app = app.clone();
    let id = id.to_owned();
    thread::spawn(move || {
        if let Err(code) = open(&app, &id) {
            open_folder::show_error(&app, &[code]);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::LanguagePreference;
    use crate::settings::Settings;
    use crate::state::AppState;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use tauri::Listener;

    fn paths(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    /// テスト用の一時フォルダー。終了時に削除する。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("md-peruse-recent-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("一時フォルダーを作成できない");
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn canonical(path: &Path) -> String {
        fs::canonicalize(path)
            .unwrap()
            .to_string_lossy()
            .into_owned()
    }

    /// 最近使ったフォルダーを持つ設定で始めた `mock_app`。
    fn app_with(recent_folders: Vec<String>) -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(AppState::new(LanguagePreference::System));
        let recents = RecentFolders::new();
        recents.sync(&recent_folders);
        app.manage(recents);
        app.manage(SettingsStore::without_saving(Settings {
            recent_folders,
            ..Settings::default()
        }));
        app.manage(crate::telemetry::Telemetry::new(
            Box::new(crate::telemetry::NullLogger),
            None,
        ));
        app
    }

    fn collect(
        app: &tauri::App<tauri::test::MockRuntime>,
        event: &'static str,
    ) -> Arc<Mutex<Vec<String>>> {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&received);
        app.listen(event, move |event| {
            sink.lock().unwrap().push(event.payload().to_owned());
        });
        received
    }

    /// 一覧の項目を開くと、そのフォルダーがワークスペースになり、先頭へ移る。
    #[test]
    fn opening_an_item_opens_the_workspace_and_moves_it_to_the_front() {
        let temp = TempDir::new("open");
        let first = temp.0.join("first");
        let second = temp.0.join("second");
        fs::create_dir(&first).unwrap();
        fs::create_dir(&second).unwrap();
        let app = app_with(vec![canonical(&first), canonical(&second)]);
        let id = app.state::<RecentFolders>().views()[1].id.clone();

        open(app.handle(), &id).expect("開けない");

        assert!(app.state::<AppState>().scope_id().is_some());
        let settings = app.state::<SettingsStore>().settings();
        assert_eq!(
            settings.recent_folders,
            [canonical(&second), canonical(&first)]
        );
        assert_eq!(settings.last_workspace, Some(canonical(&second)));
    }

    /// 未知のIDと、一覧を作り直す前のIDは、`RecentFolderNotFound` で拒否する。何も開かない。
    #[test]
    fn unknown_and_stale_ids_are_rejected() {
        let temp = TempDir::new("stale");
        let folder = temp.0.join("docs");
        fs::create_dir(&folder).unwrap();
        let app = app_with(vec![canonical(&folder)]);
        let stale = app.state::<RecentFolders>().views()[0].id.clone();
        publish(app.handle());

        for id in ["nothing", "C:\\Windows", stale.as_str()] {
            assert_eq!(
                open(app.handle(), id),
                Err(ErrorCode::RecentFolderNotFound),
                "{id}"
            );
        }
        assert!(app.state::<AppState>().scope_id().is_none());
    }

    /// フォルダーが見つからない項目は、`WorkspaceNotFound` を返し、一覧から取り除く。
    /// 開けない項目を残しても、利用者が取れる行動がない（9.2）。
    #[test]
    fn an_item_whose_folder_is_gone_is_removed() {
        let temp = TempDir::new("gone");
        let kept = temp.0.join("kept");
        fs::create_dir(&kept).unwrap();
        let gone = canonical(&kept) + "\\gone";
        let app = app_with(vec![gone, canonical(&kept)]);
        let changed = collect(&app, RECENT_FOLDERS_CHANGED_EVENT);
        let id = app.state::<RecentFolders>().views()[0].id.clone();

        assert_eq!(open(app.handle(), &id), Err(ErrorCode::WorkspaceNotFound));

        assert_eq!(
            app.state::<SettingsStore>().settings().recent_folders,
            [canonical(&kept)]
        );
        assert_eq!(app.state::<RecentFolders>().views().len(), 1);
        assert_eq!(changed.lock().unwrap().len(), 1);
    }

    /// 一覧が変わると、対応表を作り直し、Frontendへ新しい一覧を通知する。
    #[test]
    fn publishing_reissues_ids_and_notifies() {
        let app = app_with(vec!["C:\\a".to_owned()]);
        let changed = collect(&app, RECENT_FOLDERS_CHANGED_EVENT);
        let before = app.state::<RecentFolders>().views()[0].id.clone();

        publish(app.handle());

        let after = app.state::<RecentFolders>().views()[0].id.clone();
        assert_ne!(before, after);
        let changed = changed.lock().unwrap();
        assert_eq!(changed.len(), 1);
        assert!(changed[0].contains(&after), "{}", changed[0]);
    }

    /// 一覧の並びのまま、IDと表示名を持つ。表示名は末尾2コンポーネントに限る。
    #[test]
    fn views_follow_the_order_and_carry_labels_only() {
        let recents = RecentFolders::new();
        recents.sync(&paths(&["C:\\Users\\dev\\docs", "D:\\notes"]));

        let views = recents.views();

        assert_eq!(
            views
                .iter()
                .map(|view| view.label.as_str())
                .collect::<Vec<_>>(),
            ["dev\\docs", "D:\\notes"]
        );
        let json = serde_json::to_string(&views).unwrap();
        assert!(!json.contains("Users"), "{json}");
    }

    /// IDは、対応表の絶対パスへ戻せる。
    #[test]
    fn an_id_resolves_to_its_path() {
        let recents = RecentFolders::new();
        recents.sync(&paths(&["C:\\a", "C:\\b"]));

        let views = recents.views();

        assert_eq!(recents.resolve(&views[0].id).as_deref(), Some("C:\\a"));
        assert_eq!(recents.resolve(&views[1].id).as_deref(), Some("C:\\b"));
        assert_eq!(recents.resolve("recent-0-0"), None);
        assert_eq!(recents.resolve("C:\\a"), None);
    }

    /// 一覧を作り直したあと、以前の一覧のIDは拒否される。同じ位置の別のフォルダーを開かない。
    #[test]
    fn ids_from_an_earlier_list_are_rejected() {
        let recents = RecentFolders::new();
        recents.sync(&paths(&["C:\\a", "C:\\b"]));
        let stale = recents.views()[0].id.clone();

        recents.sync(&paths(&["C:\\c", "C:\\a"]));

        assert_eq!(recents.resolve(&stale), None);
        let fresh = recents.views();
        assert_ne!(fresh[0].id, stale);
        assert_eq!(recents.resolve(&fresh[0].id).as_deref(), Some("C:\\c"));
    }

    /// 空の一覧も扱える。
    #[test]
    fn an_empty_list_has_no_entries() {
        let recents = RecentFolders::new();
        recents.sync(&[]);

        assert!(recents.views().is_empty());
        assert_eq!(recents.resolve("recent-1-0"), None);
    }
}
