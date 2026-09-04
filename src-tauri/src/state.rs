//! アプリの実行時状態。
//!
//! ワークスペースのルート（6.1）と現在のUI言語（10.5）を持つ。Tauriのmanaged stateとして
//! 登録し、commandから参照する。
//!
//! ワークスペースの切り替えと終了は、Watcher・探索キャッシュ・通常タブ・loose tabの破棄を
//! 伴う（6.1）。ここが持つのはルートだけであり、破棄の対象が増えるのはWatcherを実装する
//! Phase 4-1dである。

use std::path::Path;
use std::sync::Mutex;

use crate::i18n::{Language, LanguagePreference, os_language_tag, resolve_language};
use crate::path_guard::WorkspaceRoot;

/// commandから参照するアプリの状態。
pub struct AppState {
    workspace: Mutex<Option<WorkspaceRoot>>,
    language: Mutex<Language>,
}

impl AppState {
    /// 設定値からUI言語を決めて状態を作る。
    ///
    /// 設定の読み込み（11.1）はまだ実装していないため、呼び出し側は既定値
    /// （`LanguagePreference::System`）を渡す。
    pub fn new(preference: LanguagePreference) -> Self {
        Self {
            workspace: Mutex::new(None),
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

    /// ワークスペースを開く。既に開いている場合は切り替える。
    pub fn open_workspace(&self, path: &Path) -> std::io::Result<()> {
        let root = WorkspaceRoot::open(path)?;
        *self.lock_workspace() = Some(root);
        Ok(())
    }

    /// ワークスペースを閉じる。welcome状態へ戻す（6.1）。
    pub fn close_workspace(&self) {
        *self.lock_workspace() = None;
    }

    /// 開いているワークスペースのルートに対して処理を行う。
    ///
    /// `WorkspaceRoot` を複製して返さないのは、ルートを持ち出した先で切り替えが起きると、
    /// 古いルートに対する走査や読込が新しいワークスペースの結果として扱われうるためである。
    /// ロックを保持したまま処理することで、1回の要求が見るルートを1つに固定する。
    pub fn with_workspace<T>(&self, f: impl FnOnce(&WorkspaceRoot) -> T) -> Option<T> {
        self.lock_workspace().as_ref().map(f)
    }

    fn lock_workspace(&self) -> std::sync::MutexGuard<'_, Option<WorkspaceRoot>> {
        // ロックが毒された時点で状態の一貫性は失われている。`panic = "abort"` の下では
        // 毒される経路自体が生じないため、回復は試みない（12章）。
        self.workspace.lock().expect("ワークスペースのロックに失敗")
    }

    fn lock_language(&self) -> std::sync::MutexGuard<'_, Language> {
        self.language.lock().expect("UI言語のロックに失敗")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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

        // 起動直後はwelcome状態であり、ルートを持たない（6.1）。
        assert_eq!(state.with_workspace(|root| root.path().to_owned()), None);

        state.open_workspace(&first).unwrap();
        assert_eq!(
            state.with_workspace(|root| root.path().to_owned()),
            Some(fs::canonicalize(&first).unwrap())
        );

        // 別フォルダーを開くと完全に切り替える。
        state.open_workspace(&second).unwrap();
        assert_eq!(
            state.with_workspace(|root| root.path().to_owned()),
            Some(fs::canonicalize(&second).unwrap())
        );

        state.close_workspace();
        assert_eq!(state.with_workspace(|root| root.path().to_owned()), None);
    }

    #[test]
    fn opening_a_missing_folder_leaves_the_current_workspace() {
        let temp = TempDir::new("failure");
        let existing = temp.path().join("existing");
        fs::create_dir_all(&existing).unwrap();
        let state = AppState::new(LanguagePreference::System);
        state.open_workspace(&existing).unwrap();

        // 開けなかったときに現在のワークスペースを失わない。
        assert!(state.open_workspace(&temp.path().join("missing")).is_err());
        assert_eq!(
            state.with_workspace(|root| root.path().to_owned()),
            Some(fs::canonicalize(&existing).unwrap())
        );
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
