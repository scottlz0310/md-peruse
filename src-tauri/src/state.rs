//! アプリの実行時状態。
//!
//! ワークスペースのルート（6.1）、そのルートを監視するWatcher（6.4）、現在のUI言語（10.5）を
//! 持つ。Tauriのmanaged stateとして登録し、commandから参照する。
//!
//! ワークスペースの切り替えと終了は、Watcher・探索キャッシュ・通常タブ・loose tabの破棄を
//! 伴う（6.1）。ここが持つのはルートとWatcherであり、探索キャッシュとタブはFrontendが持つ。

use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::i18n::{Language, LanguagePreference, os_language_tag, resolve_language};
use crate::path_guard::WorkspaceRoot;
use crate::watch_runtime::{ChangeSink, WorkspaceWatcher};

/// commandから参照するアプリの状態。
pub struct AppState {
    workspace: Arc<Mutex<Option<WorkspaceRoot>>>,
    /// 開いているワークスペースを監視するWatcher。
    ///
    /// ルートと別のロックにするのは、走査と読込が保持する `workspace` のロックを、監視の
    /// 開始・停止が待たないようにするためである。両者を1つのロックにすると、応答の遅い
    /// ストレージに対する走査の最中はワークスペースを閉じられない。
    watcher: Mutex<Option<WorkspaceWatcher>>,
    language: Mutex<Language>,
}

impl AppState {
    /// 設定値からUI言語を決めて状態を作る。
    ///
    /// 設定の読み込み（11.1）はまだ実装していないため、呼び出し側は既定値
    /// （`LanguagePreference::System`）を渡す。
    pub fn new(preference: LanguagePreference) -> Self {
        Self {
            workspace: Arc::new(Mutex::new(None)),
            watcher: Mutex::new(None),
            language: Mutex::new(resolve_language(preference, &os_language_tag())),
        }
    }

    /// 現在のUI言語。`IpcError` の文言の組み立てに使う。
    pub fn language(&self) -> Language {
        *self.lock_language()
    }

    /// UI言語を切り替える。メニューからの切り替え（10.5）で使う。
    pub fn set_language(&self, language: Language) {
        *self.lock_language() = language;
    }

    /// ワークスペースを開き、監視を開始する。既に開いている場合は切り替える。
    ///
    /// 監視の開始に失敗した場合はワークスペースを開かない。監視のないワークスペースは、
    /// ツリーもタブも変更に追従しないまま「開けている」ように見える。利用者からは
    /// 区別できないため、開けなかったものとして原因を示す（12章）。
    ///
    /// `sink` を引数で受けるのは、送出先が `tauri::AppHandle` に由来し、この型を
    /// 構築する時点では手に入らないためである。後から差し込む形にすると、差し込み忘れが
    /// 「イベントが届かない」という静かな失敗になる。
    pub fn open_workspace(&self, path: &Path, sink: Arc<dyn ChangeSink>) -> std::io::Result<()> {
        let root = WorkspaceRoot::open(path)?;
        // 旧Watcherを停止してから状態を破棄する（6.4）。順序を逆にすると、停止前に届いた
        // イベントが新しいワークスペースの状態へ適用されうる。
        self.close_workspace();
        let watcher = WorkspaceWatcher::start(root.path(), sink).map_err(std::io::Error::other)?;
        *self.lock_watcher() = Some(watcher);
        *self.lock_workspace() = Some(root);
        Ok(())
    }

    /// ワークスペースを閉じる。welcome状態へ戻す（6.1）。
    pub fn close_workspace(&self) {
        // Watcherを先に落とす。`Drop` が停止を指示し、監視スレッドの終了まで待つ（6.4）。
        *self.lock_watcher() = None;
        *self.lock_workspace() = None;
    }

    /// 開いているワークスペースの監視スコープID。閉じていれば `None` を返す。
    ///
    /// Frontendは、自分が保持するスコープと一致しない通知を破棄する（6.4）。ワークスペースを
    /// 開いた応答へ載せるのはこの値である。
    pub fn scope_id(&self) -> Option<String> {
        self.lock_watcher()
            .as_ref()
            .map(|watcher| watcher.scope_id().to_owned())
    }

    /// ワークスペースのハンドルを得る。
    ///
    /// 走査と読込はブロッキングスレッドで実行するため（design-decisions.md 5.3）、
    /// `State` の借用を越えて持ち出せる形が要る。複製するのはハンドルだけであり、
    /// `WorkspaceRoot` そのものはロックの内側から出さない。
    pub fn workspace(&self) -> WorkspaceHandle {
        WorkspaceHandle(Arc::clone(&self.workspace))
    }

    fn lock_workspace(&self) -> std::sync::MutexGuard<'_, Option<WorkspaceRoot>> {
        // ロックが毒された時点で状態の一貫性は失われている。`panic = "abort"` の下では
        // 毒される経路自体が生じないため、回復は試みない（12章）。
        self.workspace.lock().expect("ワークスペースのロックに失敗")
    }

    fn lock_watcher(&self) -> std::sync::MutexGuard<'_, Option<WorkspaceWatcher>> {
        self.watcher.lock().expect("Watcherのロックに失敗")
    }

    fn lock_language(&self) -> std::sync::MutexGuard<'_, Language> {
        self.language.lock().expect("UI言語のロックに失敗")
    }
}

/// ワークスペースのルートへ、`AppState` の借用を越えて到達するためのハンドル。
///
/// `Send + 'static` であることがこの型の要件である。走査と読込はブロッキングスレッドへ
/// 渡すため（design-decisions.md 5.3）、`State<'_, AppState>` の借用のままでは持ち出せない。
#[derive(Clone)]
pub struct WorkspaceHandle(Arc<Mutex<Option<WorkspaceRoot>>>);

impl WorkspaceHandle {
    /// 開いているワークスペースのルートに対して処理を行う。開いていなければ `None` を返す。
    ///
    /// `WorkspaceRoot` を複製して返さないのは、ルートを持ち出した先で切り替えが起きると、
    /// 古いルートに対する走査や読込が新しいワークスペースの結果として扱われうるためである。
    /// ロックを保持したまま処理することで、1回の要求が見るルートを1つに固定する。
    pub fn with<T>(&self, f: impl FnOnce(&WorkspaceRoot) -> T) -> Option<T> {
        // ロックが毒された時点で状態の一貫性は失われている。`panic = "abort"` の下では
        // 毒される経路自体が生じないため、回復は試みない（12章）。
        self.0
            .lock()
            .expect("ワークスペースのロックに失敗")
            .as_ref()
            .map(f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::error::ErrorCode;
    use crate::ipc::types::FileChangeEvent;
    use std::fs;

    /// 送出を捨てる `ChangeSink`。ここで確かめるのはライフサイクルであり、送出の内容は
    /// `watch_runtime` のテストで固定する。
    struct DiscardingSink;

    impl ChangeSink for DiscardingSink {
        fn file_change(&self, _event: FileChangeEvent) {}
        fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
    }

    fn sink() -> Arc<dyn ChangeSink> {
        Arc::new(DiscardingSink)
    }

    /// テスト用の一時フォルダー。終了時に削除する。
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("md-peruse-state-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("一時フォルダーを作成できない");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn workspace_starts_closed_and_can_be_switched() {
        let temp = TempDir::new("switch");
        let first = temp.path().join("first");
        let second = temp.path().join("second");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        let state = AppState::new(LanguagePreference::System);

        // 起動直後はwelcome状態であり、ルートもスコープも持たない（6.1）。
        assert_eq!(state.workspace().with(|root| root.path().to_owned()), None);
        assert_eq!(state.scope_id(), None);

        state.open_workspace(&first, sink()).unwrap();
        assert_eq!(
            state.workspace().with(|root| root.path().to_owned()),
            Some(fs::canonicalize(&first).unwrap())
        );
        let first_scope = state.scope_id().expect("スコープが採番されない");

        // 別フォルダーを開くと完全に切り替える。
        state.open_workspace(&second, sink()).unwrap();
        assert_eq!(
            state.workspace().with(|root| root.path().to_owned()),
            Some(fs::canonicalize(&second).unwrap())
        );

        // 切り替えのたびにスコープを採番し直す。旧Watcherが停止の直前に送出した
        // イベントは、Frontendがスコープの不一致で破棄する（6.4）。
        let second_scope = state.scope_id().expect("スコープが採番されない");
        assert_ne!(first_scope, second_scope);

        state.close_workspace();
        assert_eq!(state.workspace().with(|root| root.path().to_owned()), None);
        assert_eq!(state.scope_id(), None);
    }

    #[test]
    fn opening_a_missing_folder_leaves_the_current_workspace() {
        let temp = TempDir::new("failure");
        let existing = temp.path().join("existing");
        fs::create_dir_all(&existing).unwrap();
        let state = AppState::new(LanguagePreference::System);
        state.open_workspace(&existing, sink()).unwrap();

        // 開けなかったときに現在のワークスペースを失わない。
        assert!(
            state
                .open_workspace(&temp.path().join("missing"), sink())
                .is_err()
        );
        assert_eq!(
            state.workspace().with(|root| root.path().to_owned()),
            Some(fs::canonicalize(&existing).unwrap())
        );
    }

    #[test]
    fn the_workspace_handle_reaches_the_root_from_another_thread() {
        // 走査と読込はブロッキングスレッドで実行する（design-decisions.md 5.3）。ハンドルが
        // `Send + 'static` でなくなるとこれらをメインスレッドへ戻すしかなくなり、応答の遅い
        // ストレージでUIが止まる。別スレッドから到達できることをここで固定する。
        let temp = TempDir::new("thread");
        let state = AppState::new(LanguagePreference::System);
        state.open_workspace(temp.path(), sink()).unwrap();

        let handle = state.workspace();
        let seen = std::thread::spawn(move || handle.with(|root| root.path().to_owned()))
            .join()
            .expect("別スレッドでの参照に失敗");

        assert_eq!(seen, Some(fs::canonicalize(temp.path()).unwrap()));
    }

    #[test]
    fn language_follows_the_preference() {
        assert_eq!(
            AppState::new(LanguagePreference::Ja).language(),
            Language::Ja
        );
        assert_eq!(
            AppState::new(LanguagePreference::En).language(),
            Language::En
        );

        let state = AppState::new(LanguagePreference::Ja);
        state.set_language(Language::En);
        assert_eq!(state.language(), Language::En);
    }
}
