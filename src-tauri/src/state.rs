//! アプリの実行時状態。
//!
//! ワークスペースのルート（6.1）、そのルートを監視するWatcher（6.4）、loose tab（9.1）の
//! 暗黙のルートとファイル単体のWatcher、現在のUI言語（10.5）を持つ。画像resource ID（5.4）は
//! スコープに属し、ルートと同じ単位で作り直す。Tauriのmanaged stateとして登録し、commandから
//! 参照する。
//!
//! スコープは、ワークスペースと、loose tab 1つにつき1つの2種類がある。読込と画像の発行は
//! スコープのIDで引く。ワークスペースの切り替えと終了は、Watcher・探索キャッシュ・通常タブ・
//! loose tabの破棄を伴う（6.1）。ここが持つのはルートとWatcherであり、探索キャッシュとタブは
//! Frontendが持つ。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use crate::file_kind::is_markdown_path;
use crate::i18n::{Language, LanguagePreference, os_language_tag, resolve_language};
use crate::image::resource::ImageResources;
use crate::ipc::error::ErrorCode;
use crate::ipc::types::WorkspaceOpenedEvent;
use crate::path_guard::{PathRejection, ResolveError, WorkspaceRoot, is_valid_name, is_within};
use crate::settings::recent_folder_label;
use crate::watch_runtime::{ChangeSink, LooseWatcher, WorkspaceWatcher, new_scope_id};

/// 監視しているフォルダーが、検証したときのまま、暗黙のルートの中にあるか。
///
/// `folder` は `canonicalize` 済みの絶対パスである。いま解決し直した結果が同じでなければ、途中の
/// フォルダーがjunctionなどへ差し替えられている（7.1）。
fn verify_watched_folder(root: &Path, folder: &Path) -> Result<(), ResolveError> {
    let now = fs::canonicalize(folder).map_err(ResolveError::Io)?;
    if now != folder || !is_within(root, &now) {
        return Err(PathRejection::Outside.into());
    }
    Ok(())
}

/// loose tabのWatcherを開始する関数。テストで開始の失敗を再現できるよう、差し替えられる形にする。
type StartLooseWatcher<'a> =
    dyn Fn(&Path, &Path, &str, String, Arc<dyn ChangeSink>) -> notify::Result<LooseWatcher> + 'a;

/// 開いているスコープ。ワークスペースか、loose tabの暗黙のルートである。
///
/// ルートと画像resource IDを1つのロックの内側に置く。発行は「どのルートに対して解決した
/// パスを、どの対応表へ登録するか」を1回の要求の中で固定する必要があり、別々に取ると
/// 切り替えの前後をまたいで旧ルートのパスを新しい対応表へ登録しうる。
struct OpenScope {
    /// 監視スコープID。Frontendはこの値でスコープを指す（6.4）。
    id: String,
    root: WorkspaceRoot,
    /// 監視スレッドとも共有する。世代を進めるのは監視である（5.4）。
    images: Arc<ImageResources>,
}

/// loose tabのスコープ。所在フォルダーが暗黙のルートになる（9.1）。
struct LooseScope {
    scope: OpenScope,
    /// 監視している文書。暗黙のルートからの相対パスで、ファイル名だけのこともあれば、
    /// 相対リンクで移った先（`sub/b.md`）のこともある。
    file: String,
    /// 監視を付け替えるときに、同じ送出先を使う。
    sink: Arc<dyn ChangeSink>,
    /// 監視先の確定を受けた、最新のタブIDと読込世代（`retarget_loose`）。
    confirmed: Option<(String, u32)>,
}

/// 開いているスコープの全体。1つのロックの内側に置く。
#[derive(Default)]
struct Scopes {
    workspace: Option<OpenScope>,
    loose: Vec<LooseScope>,
}

impl Scopes {
    fn get(&self, scope_id: &str) -> Option<&OpenScope> {
        self.workspace
            .iter()
            .chain(self.loose.iter().map(|loose| &loose.scope))
            .find(|scope| scope.id == scope_id)
    }
}

/// loose tabとして開いた文書。Frontendへ渡す表現の元になる。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LooseOpened {
    pub scope_id: String,
    /// 暗黙のルートからの相対パス。
    pub file: String,
    /// 暗黙のルート（所在フォルダー）の表示名。最近使ったフォルダーと同じく末尾2コンポーネント。
    pub label: String,
}

/// commandから参照するアプリの状態。
pub struct AppState {
    scopes: Arc<Mutex<Scopes>>,
    /// 開いているワークスペースを監視するWatcher。
    ///
    /// ルートと別のロックにするのは、走査と読込が保持する `scopes` のロックを、監視の
    /// 開始・停止が待たないようにするためである。両者を1つのロックにすると、応答の遅い
    /// ストレージに対する走査の最中はワークスペースを閉じられない。
    watcher: Mutex<Option<WorkspaceWatcher>>,
    /// loose tabのファイル単体を監視するWatcher。スコープIDで引く。`watcher` と同じ理由で
    /// `scopes` とは別のロックにする。
    loose_watchers: Arc<Mutex<Vec<LooseWatcher>>>,
    language: Mutex<Language>,
}

impl AppState {
    /// 設定値（11.1）からUI言語を決めて状態を作る。
    pub fn new(preference: LanguagePreference) -> Self {
        Self {
            scopes: Arc::new(Mutex::new(Scopes::default())),
            watcher: Mutex::new(None),
            loose_watchers: Arc::new(Mutex::new(Vec::new())),
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
    pub fn open_workspace(&self, path: &Path, sink: Arc<dyn ChangeSink>) -> io::Result<()> {
        self.install_workspace(WorkspaceRoot::open(path)?, sink)
    }

    /// 開いたルートを、ワークスペースとして据える。`open_workspace` の後半である。
    ///
    /// ルートを開く（`WorkspaceRoot::open`）のは、応答の遅いストレージで長く待ちうる。呼び出し側が
    /// 開閉のロックの外でルートを開いてから据えられるよう、分けている（起動時の復元、9.2）。
    pub fn install_workspace(
        &self,
        root: WorkspaceRoot,
        sink: Arc<dyn ChangeSink>,
    ) -> io::Result<()> {
        // 旧Watcherを停止してから状態を破棄する（6.4）。順序を逆にすると、停止前に届いた
        // イベントが新しいワークスペースの状態へ適用されうる。loose tabも破棄する（6.1）。
        self.close_workspace();
        // 画像resource IDはワークスペースを開くたびに作り直す。ソルトごと替わるため、
        // 旧ワークスペースのIDは新しい対応表で拒否される（5.4）。
        let images = Arc::new(ImageResources::new());
        let watcher = WorkspaceWatcher::start(root.path(), sink, Arc::clone(&images))
            .map_err(io::Error::other)?;
        let id = watcher.scope_id().to_owned();
        *self.lock_watcher() = Some(watcher);
        self.lock_scopes().workspace = Some(OpenScope { id, root, images });
        Ok(())
    }

    /// ワークスペースを閉じる。welcome状態へ戻す（6.1）。loose tabも破棄する。
    pub fn close_workspace(&self) {
        // Watcherを先に落とす。`Drop` が停止を指示し、監視スレッドの終了まで待つ（6.4）。
        *self.lock_watcher() = None;
        self.lock_loose_watchers().clear();
        *self.lock_scopes() = Scopes::default();
    }

    /// ワークスペース外のMarkdownファイルを、loose tabのスコープとして開く（9.1）。
    ///
    /// 所在フォルダーを暗黙のルートとし、そのファイル1件を監視する。同じ暗黙のルートで同じ
    /// 文書を監視しているスコープがあれば、それを返す。同一文書を重複して開かないためである。
    ///
    /// 監視の開始に失敗したときは開かない。監視のないタブは、外部の更新に追従しないまま
    /// 開けているように見える（ワークスペースと同じ理由）。
    pub fn open_loose(&self, path: &Path, sink: Arc<dyn ChangeSink>) -> io::Result<LooseOpened> {
        let file_path = fs::canonicalize(path)?;
        if !file_path.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "loose tabにはファイルを指定する",
            ));
        }
        let folder = file_path
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "所在フォルダーがない"))?;
        let name = file_path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| is_valid_name(name))
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "扱えないファイル名"))?
            .to_owned();
        let label = recent_folder_label(&folder.to_string_lossy());

        if let Some(found) = self.lock_scopes().loose.iter().find(|loose| {
            loose.scope.root.path() == folder && loose.file.eq_ignore_ascii_case(&name)
        }) {
            return Ok(LooseOpened {
                scope_id: found.scope.id.clone(),
                file: found.file.clone(),
                label,
            });
        }

        let root = WorkspaceRoot::open(folder)?;
        let id = new_scope_id();
        let watcher = LooseWatcher::start(
            root.path(),
            root.path(),
            &name,
            id.clone(),
            Arc::clone(&sink),
        )
        .map_err(io::Error::other)?;
        self.lock_loose_watchers().push(watcher);
        self.lock_scopes().loose.push(LooseScope {
            scope: OpenScope {
                id: id.clone(),
                root,
                images: Arc::new(ImageResources::new()),
            },
            file: name.clone(),
            sink,
            confirmed: None,
        });
        Ok(LooseOpened {
            scope_id: id,
            file: name,
            label,
        })
    }

    /// loose tabのスコープを閉じ、監視を止める。開いていないスコープなら何もしない。
    ///
    /// タブを閉じたときと、上限で退避されたときに、Frontendが求める（6.4）。
    pub fn close_loose(&self, scope_id: &str) {
        self.workspace().close_loose(scope_id);
    }

    /// 絶対パスが開いているワークスペースの中にあれば、そのスコープIDとワークスペース相対パスを
    /// 返す。ワークスペースを開いていないとき、境界外のとき、実在しないときは `None`。
    ///
    /// ドロップされたファイルを、通常タブとloose tabのどちらで開くかの判定に使う（10.4）。
    pub fn workspace_document(&self, absolute: &Path) -> Option<(String, String)> {
        let scopes = self.lock_scopes();
        let workspace = scopes.workspace.as_ref()?;
        let relative = workspace.root.relativize(absolute)?;
        Some((workspace.id.clone(), relative))
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

    /// 開いているワークスペースのルート。正規化済みの絶対パスである（`WorkspaceRoot::path`）。
    ///
    /// 最近使ったフォルダーと最後のワークスペースへ保存するのはこの値で、Frontendへは渡さない
    /// （7.1）。閉じていれば `None` を返す。
    pub fn workspace_path(&self) -> Option<PathBuf> {
        self.lock_scopes()
            .workspace
            .as_ref()
            .map(|open| open.root.path().to_owned())
    }

    /// 開いているワークスペースの、Frontendへ渡す表現。閉じていれば `None` を返す。
    ///
    /// スコープIDと表示名を別々のロックから読むため、開閉と並行して呼ぶと別のワークスペースの
    /// ものが混ざりうる。開閉を直列にするロック（`crate::open_folder`）の内側で呼ぶこと。
    pub fn current_workspace(&self) -> Option<WorkspaceOpenedEvent> {
        let scope_id = self.scope_id()?;
        let path = self.workspace_path()?;
        Some(WorkspaceOpenedEvent {
            scope_id,
            label: recent_folder_label(&path.to_string_lossy()),
        })
    }

    /// スコープのハンドルを得る。
    ///
    /// 走査と読込はブロッキングスレッドで実行するため（design-decisions.md 5.3）、
    /// `State` の借用を越えて持ち出せる形が要る。複製するのはハンドルだけであり、
    /// `WorkspaceRoot` そのものはロックの内側から出さない。
    pub fn workspace(&self) -> WorkspaceHandle {
        WorkspaceHandle {
            scopes: Arc::clone(&self.scopes),
            loose_watchers: Arc::clone(&self.loose_watchers),
        }
    }

    fn lock_scopes(&self) -> std::sync::MutexGuard<'_, Scopes> {
        // ロックが毒された時点で状態の一貫性は失われている。`panic = "abort"` の下では
        // 毒される経路自体が生じないため、回復は試みない（12章）。
        self.scopes.lock().expect("スコープのロックに失敗")
    }

    fn lock_watcher(&self) -> std::sync::MutexGuard<'_, Option<WorkspaceWatcher>> {
        self.watcher.lock().expect("Watcherのロックに失敗")
    }

    fn lock_loose_watchers(&self) -> std::sync::MutexGuard<'_, Vec<LooseWatcher>> {
        self.loose_watchers
            .lock()
            .expect("loose tabのWatcherのロックに失敗")
    }

    fn lock_language(&self) -> std::sync::MutexGuard<'_, Language> {
        self.language.lock().expect("UI言語のロックに失敗")
    }
}

/// スコープのルートへ、`AppState` の借用を越えて到達するためのハンドル。
///
/// `Send + 'static` であることがこの型の要件である。走査と読込はブロッキングスレッドへ
/// 渡すため（design-decisions.md 5.3）、`State<'_, AppState>` の借用のままでは持ち出せない。
///
/// ワークスペースだけを指す `with` と `with_images` に加え、スコープIDで引く `with_scope` と
/// `with_scope_images`、画像resource IDから全スコープを探す `find_image` を持つ。
#[derive(Clone)]
pub struct WorkspaceHandle {
    scopes: Arc<Mutex<Scopes>>,
    loose_watchers: Arc<Mutex<Vec<LooseWatcher>>>,
}

impl WorkspaceHandle {
    /// 開いているワークスペースのルートに対して処理を行う。開いていなければ `None` を返す。
    ///
    /// `WorkspaceRoot` を複製して返さないのは、ルートを持ち出した先で切り替えが起きると、
    /// 古いルートに対する走査や読込が新しいワークスペースの結果として扱われうるためである。
    /// ロックを保持したまま処理することで、1回の要求が見るルートを1つに固定する。
    pub fn with<T>(&self, f: impl FnOnce(&WorkspaceRoot) -> T) -> Option<T> {
        self.with_images(|root, _| f(root))
    }

    /// `with` に加えて、そのワークスペースの画像resource IDを渡す。
    pub fn with_images<T>(
        &self,
        f: impl FnOnce(&WorkspaceRoot, &ImageResources) -> T,
    ) -> Option<T> {
        self.lock()
            .workspace
            .as_ref()
            .map(|workspace| f(&workspace.root, &workspace.images))
    }

    /// スコープIDで引いたスコープ（ワークスペースかloose tab）のルートに対して処理を行う。
    /// 開いていないスコープなら `None` を返す。
    ///
    /// 要求へスコープIDを載せるのは、切り替えの前に発行した要求が、切り替え後の別のスコープの
    /// 同じ相対パスへ当たらないようにするためである（6.4）。
    pub fn with_scope<T>(&self, scope_id: &str, f: impl FnOnce(&WorkspaceRoot) -> T) -> Option<T> {
        self.with_scope_images(scope_id, |root, _| f(root))
    }

    /// `with_scope` に加えて、そのスコープの画像resource IDを渡す。
    pub fn with_scope_images<T>(
        &self,
        scope_id: &str,
        f: impl FnOnce(&WorkspaceRoot, &ImageResources) -> T,
    ) -> Option<T> {
        self.lock()
            .get(scope_id)
            .map(|scope| f(&scope.root, &scope.images))
    }

    /// 画像resource IDが、いずれかのスコープの対応表にあれば、そのスコープのルートと、IDが
    /// 指すスコープ相対パスに対して処理を行う。どの対応表にも無ければ `None` を返す。
    ///
    /// IDはスコープごとのソルトから作るため、別のスコープのIDは対応表に存在しない（5.4）。
    /// 配信の要求はスコープIDを持たないため、全スコープから探す。
    pub fn find_image<T>(
        &self,
        resource_id: &str,
        f: impl FnOnce(&WorkspaceRoot, String) -> T,
    ) -> Option<T> {
        let scopes = self.lock();
        let (scope, relative) = scopes
            .workspace
            .iter()
            .chain(scopes.loose.iter().map(|loose| &loose.scope))
            .find_map(|scope| Some((scope, scope.images.lookup(resource_id)?)))?;
        Some(f(&scope.root, relative))
    }

    /// loose tabのスコープを閉じ、監視を止める。開いていないスコープなら何もしない。
    ///
    /// `AppState::close_loose` の実体。commandはブロッキングスレッドで閉じるため、
    /// `AppState` の借用を越えて持ち出せるハンドルから呼べるようにしている。
    pub fn close_loose(&self, scope_id: &str) {
        // Watcherを先に落とす。停止は監視スレッドの終了まで待つ。
        self.loose_watchers
            .lock()
            .expect("loose tabのWatcherのロックに失敗")
            .retain(|watcher| watcher.scope_id() != scope_id);
        self.lock().loose.retain(|loose| loose.scope.id != scope_id);
    }

    /// loose tabの監視を、タブが表示している文書へ付け替える。
    ///
    /// loose tabの監視は、開いているファイル1件に限る（6.4）。相対リンクで同じ暗黙のルートの
    /// 別の文書へ移ると、タブの文書が替わるため、表示している文書に合わせる。同じ文書では何も
    /// しない。ワークスペースのスコープと、開いていないスコープでも何もしない。
    ///
    /// `file` はFrontendから届くパスであり、暗黙のルートに対して再検証する（7.1）。相対パスの
    /// 形式（`..`、絶対パス、区切りの表記）、Markdownファイルであること、実在すること、
    /// junctionなどを経由しても暗黙のルートの中にあることを、状態を変える前に確かめる。逸脱した
    /// 要求は、確定した世代も監視も変えず、`ResolveError` を返す。検証しないと、ルート外の
    /// フォルダーを監視でき、その成否が通知から観測できる。
    ///
    /// 呼ぶのは、Frontendが読込の応答を採用したときだけである。読んだだけで付け替えると、
    /// 素早くリンクを辿って応答が逆順に完了したとき、Frontendが世代の判定で捨てた古い応答の文書へ
    /// 監視が移り、表示中の文書の更新を検知できなくなる。`tab_id` と `generation` は、その
    /// 読込のタブと世代である。同じタブで、すでに確定した世代以下の要求は、`invoke` の到着順や
    /// 実行順が入れ替わったものとして捨てる。別のタブ（スコープを開き直した場合）は世代が
    /// 0から数え直しになるため、世代を比べずに受ける。
    ///
    /// Watcherを開始できなかったときは、そのスコープの送出先へ監視が止まったことを知らせる。
    pub fn retarget_loose(
        &self,
        scope_id: &str,
        file: &str,
        tab_id: &str,
        generation: u32,
    ) -> Result<(), ResolveError> {
        self.retarget_loose_with(scope_id, file, tab_id, generation, &LooseWatcher::start)
    }

    /// `retarget_loose` の本体。Watcherの開始を引数で受けるのは、開始の失敗の扱いをテストで
    /// 確かめるためである。開始に失敗させるには、検証を通った直後にフォルダーが消える競合が要る。
    fn retarget_loose_with(
        &self,
        scope_id: &str,
        file: &str,
        tab_id: &str,
        generation: u32,
        start: &StartLooseWatcher<'_>,
    ) -> Result<(), ResolveError> {
        let (root, folder, sink) = {
            let mut scopes = self.lock();
            let Some(loose) = scopes
                .loose
                .iter_mut()
                .find(|loose| loose.scope.id == scope_id)
            else {
                return Ok(());
            };
            if !is_markdown_path(file) {
                return Err(PathRejection::Malformed.into());
            }
            // 検証で確定した場所（`canonicalize` 済みの絶対パス）を、そのまま監視する。
            let resolved = loose.scope.root.resolve(file)?;
            let folder = resolved
                .parent()
                .ok_or(ResolveError::Rejected(PathRejection::Malformed))?
                .to_owned();
            if let Some((confirmed_tab, confirmed)) = &loose.confirmed {
                if confirmed_tab == tab_id && generation <= *confirmed {
                    return Ok(());
                }
            }
            loose.confirmed = Some((tab_id.to_owned(), generation));
            if loose.file == file {
                return Ok(());
            }
            // 確定した文書は、Watcherを付け替える前に記録する。付け替えの間に届く、より新しい
            // 要求が、この記録との差で「付け替えが要るか」を判断できる。
            loose.file = file.to_owned();
            (
                loose.scope.root.path().to_owned(),
                folder,
                Arc::clone(&loose.sink),
            )
        };
        let mut watchers = self
            .loose_watchers
            .lock()
            .expect("loose tabのWatcherのロックに失敗");
        // Watcherのロックを待つ間に、スコープが閉じられた、またはより新しい要求が別の文書を
        // 確定した場合は、この文書の付け替えをやめる。新しい要求は自分で付け替える。止める前に
        // 確かめるのは、新しい要求が付け替えを済ませた後にここで止めると、Watcherが無くなるためである。
        let current = self
            .lock()
            .loose
            .iter()
            .find(|loose| loose.scope.id == scope_id)
            .map(|loose| loose.file.clone());
        if current.as_deref() != Some(file) {
            return Ok(());
        }
        // 旧Watcherを止める。停止は監視スレッドの終了まで待つ。
        watchers.retain(|watcher| watcher.scope_id() != scope_id);
        match start(&root, &folder, file, scope_id.to_owned(), Arc::clone(&sink)) {
            Ok(watcher) => {
                // 検証から開始までの間に、途中のフォルダーが差し替えられていないかを、開始の後に
                // 確かめる。開いた監視は、差し替え前のフォルダーを指し続けるため、開始の前に
                // 差し替えられていた場合を、ここで検出できる。差し替えられていたら、監視を捨てる。
                if let Err(error) = verify_watched_folder(&root, &folder) {
                    drop(watcher);
                    drop(watchers);
                    // 監視が無い状態を、確定した文書として記録しない。同じ文書の次の要求が、
                    // 「すでに監視している」として何もしないと、監視が戻らない。
                    if let Some(loose) = self
                        .lock()
                        .loose
                        .iter_mut()
                        .find(|loose| loose.scope.id == scope_id)
                    {
                        loose.file.clear();
                    }
                    return Err(error);
                }
                watchers.push(watcher);
            }
            Err(_) => {
                drop(watchers);
                sink.watcher_error(scope_id, ErrorCode::WatcherStopped);
            }
        }
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Scopes> {
        // ロックが毒された時点で状態の一貫性は失われている。`panic = "abort"` の下では
        // 毒される経路自体が生じないため、回復は試みない（12章）。
        self.scopes.lock().expect("スコープのロックに失敗")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::error::ErrorCode;
    use crate::ipc::types::FileChangeEvent;

    /// 送出を捨てる `ChangeSink`。ここで確かめるのはライフサイクルであり、送出の内容は
    /// `watch_runtime` のテストで固定する。
    struct DiscardingSink;

    impl ChangeSink for DiscardingSink {
        fn file_change(&self, _event: FileChangeEvent) {}
        fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
        fn images_changed(&self, _scope_id: &str) {}
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

    /// ワークスペースを開き直すと画像resource IDを作り直し、旧IDを拒否する（5.4）。
    ///
    /// 同じフォルダーを開き直した場合も対象とする。相対パスが同じでもソルトが替わるため、
    /// 旧IDは新しい対応表に存在しない。
    #[test]
    fn switching_workspaces_invalidates_image_ids() {
        let temp = TempDir::new("images");
        let state = AppState::new(LanguagePreference::System);
        state.open_workspace(temp.path(), sink()).unwrap();
        let old_id = state
            .workspace()
            .with_images(|_, images| images.issue("a.png"))
            .unwrap();

        state.open_workspace(temp.path(), sink()).unwrap();

        let (old_lookup, new_id) = state
            .workspace()
            .with_images(|_, images| (images.lookup(&old_id), images.issue("a.png")))
            .unwrap();
        assert_eq!(old_lookup, None);
        assert_ne!(new_id, old_id);
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

    /// loose tabのファイルを書いて、そのパスを返す。
    fn write_document(folder: &Path, name: &str) -> PathBuf {
        fs::create_dir_all(folder).unwrap();
        let path = folder.join(name);
        fs::write(&path, b"# doc\n").unwrap();
        path
    }

    /// ワークスペースを開いた状態と、ワークスペース外のMarkdownファイル。
    fn with_workspace_and_outside(name: &str) -> (TempDir, AppState, PathBuf) {
        let temp = TempDir::new(name);
        let workspace = temp.path().join("ws");
        fs::create_dir_all(&workspace).unwrap();
        let outside = write_document(&temp.path().join("outside"), "note.md");
        let state = AppState::new(LanguagePreference::System);
        state.open_workspace(&workspace, sink()).unwrap();
        (temp, state, outside)
    }

    /// loose tabは所在フォルダーを暗黙のルートとする。ワークスペースとは別のスコープで、
    /// スコープIDで読み分けられる（9.1）。
    #[test]
    fn a_loose_document_gets_its_own_scope_rooted_at_its_folder() {
        let (temp, state, outside) = with_workspace_and_outside("loose");
        let workspace_scope = state.scope_id().unwrap();

        let opened = state.open_loose(&outside, sink()).unwrap();

        assert_ne!(opened.scope_id, workspace_scope);
        assert_eq!(opened.file, "note.md");
        // 表示名は所在フォルダーの末尾2コンポーネントで、絶対パスの全体は含まない（7.1）。
        assert!(opened.label.ends_with("outside"), "{}", opened.label);
        assert!(!opened.label.contains("Users"), "{}", opened.label);
        let handle = state.workspace();
        assert_eq!(
            handle.with_scope(&opened.scope_id, |root| root.path().to_owned()),
            Some(fs::canonicalize(temp.path().join("outside")).unwrap())
        );
        assert_eq!(
            handle.with_scope(&workspace_scope, |root| root.path().to_owned()),
            Some(fs::canonicalize(temp.path().join("ws")).unwrap())
        );
        // 開いていないスコープのIDでは引けない。
        assert_eq!(handle.with_scope("unknown", |_| ()), None);
    }

    /// 同じ暗黙のルートの同じ文書は、開き直しても同じスコープを返す。同一文書を重複して
    /// 開かないためである（9.1）。別の文書は別のスコープになる。
    #[test]
    fn the_same_document_reuses_its_scope() {
        let (_temp, state, outside) = with_workspace_and_outside("dedupe");
        let sibling = write_document(outside.parent().unwrap(), "other.md");

        let first = state.open_loose(&outside, sink()).unwrap();
        let again = state.open_loose(&outside, sink()).unwrap();
        let other = state.open_loose(&sibling, sink()).unwrap();

        assert_eq!(again.scope_id, first.scope_id);
        assert_ne!(other.scope_id, first.scope_id);
        assert_eq!(state.lock_loose_watchers().len(), 2);
    }

    #[test]
    fn folders_and_missing_files_are_not_opened_as_documents() {
        let (temp, state, _) = with_workspace_and_outside("invalid");

        assert!(
            state
                .open_loose(&temp.path().join("outside"), sink())
                .is_err()
        );
        assert!(
            state
                .open_loose(&temp.path().join("outside").join("missing.md"), sink())
                .is_err()
        );
        assert_eq!(state.lock_loose_watchers().len(), 0);
    }

    /// タブを閉じたときにスコープと監視を破棄する。開いていないスコープを閉じても何も起きない。
    #[test]
    fn closing_a_loose_scope_releases_it() {
        let (_temp, state, outside) = with_workspace_and_outside("close-loose");
        let opened = state.open_loose(&outside, sink()).unwrap();

        state.close_loose("unknown");
        assert!(
            state
                .workspace()
                .with_scope(&opened.scope_id, |_| ())
                .is_some()
        );

        state.close_loose(&opened.scope_id);

        assert_eq!(state.workspace().with_scope(&opened.scope_id, |_| ()), None);
        assert_eq!(state.lock_loose_watchers().len(), 0);
        // ワークスペースには触れない。
        assert!(state.scope_id().is_some());
    }

    /// ワークスペースを切り替える、または閉じると、loose tabも破棄する（6.1）。
    #[test]
    fn switching_or_closing_the_workspace_discards_loose_scopes() {
        let (temp, state, outside) = with_workspace_and_outside("discard");
        let first = state.open_loose(&outside, sink()).unwrap();
        state
            .open_workspace(&temp.path().join("outside"), sink())
            .unwrap();
        assert_eq!(state.workspace().with_scope(&first.scope_id, |_| ()), None);
        assert_eq!(state.lock_loose_watchers().len(), 0);

        let second = state.open_loose(&outside, sink()).unwrap();
        state.close_workspace();
        assert_eq!(state.workspace().with_scope(&second.scope_id, |_| ()), None);
        assert_eq!(state.lock_loose_watchers().len(), 0);
    }

    /// ドロップされたファイルがワークスペースの中にあるかの判定。中ならワークスペース相対パスを
    /// 返し、通常タブで開く。外、ワークスペースが無い、実在しないときは返さない（10.4）。
    #[test]
    fn a_document_inside_the_workspace_is_recognized() {
        let temp = TempDir::new("inside");
        let workspace = temp.path().join("ws");
        let inside = write_document(&workspace.join("docs"), "a.md");
        let outside = write_document(&temp.path().join("elsewhere"), "b.md");
        let state = AppState::new(LanguagePreference::System);
        assert_eq!(state.workspace_document(&inside), None);

        state.open_workspace(&workspace, sink()).unwrap();
        let scope = state.scope_id().unwrap();

        assert_eq!(
            state.workspace_document(&inside),
            Some((scope, "docs/a.md".to_owned()))
        );
        assert_eq!(state.workspace_document(&outside), None);
        assert_eq!(
            state.workspace_document(&workspace.join("missing.md")),
            None
        );
    }

    /// 画像resource IDは、それを発行したスコープのルートで解決する。別のスコープのIDや未知のIDは
    /// どの対応表にも無い（5.4）。
    #[test]
    fn image_ids_resolve_within_the_scope_that_issued_them() {
        let (temp, state, outside) = with_workspace_and_outside("image-scopes");
        let opened = state.open_loose(&outside, sink()).unwrap();
        let handle = state.workspace();
        let loose_id = handle
            .with_scope_images(&opened.scope_id, |_, images| images.issue("a.png"))
            .unwrap();
        let workspace_id = handle
            .with_images(|_, images| images.issue("a.png"))
            .unwrap();

        assert_ne!(loose_id, workspace_id);
        assert_eq!(
            handle.find_image(&loose_id, |root, relative| (
                root.path().to_owned(),
                relative
            )),
            Some((
                fs::canonicalize(temp.path().join("outside")).unwrap(),
                "a.png".to_owned()
            ))
        );
        assert_eq!(
            handle.find_image(&workspace_id, |root, relative| (
                root.path().to_owned(),
                relative
            )),
            Some((
                fs::canonicalize(temp.path().join("ws")).unwrap(),
                "a.png".to_owned()
            ))
        );
        assert_eq!(handle.find_image("unknown", |_, _| ()), None);

        // スコープを閉じると、そのスコープのIDは引けなくなる。
        state.close_loose(&opened.scope_id);
        assert_eq!(handle.find_image(&loose_id, |_, _| ()), None);
    }

    /// 監視を付け替えても、スコープと画像resource IDは保たれる。ワークスペースと
    /// 開いていないスコープに対しては何もしない。
    #[test]
    fn retargeting_keeps_the_scope() {
        let (_temp, state, outside) = with_workspace_and_outside("retarget");
        let opened = state.open_loose(&outside, sink()).unwrap();
        let handle = state.workspace();
        let id = handle
            .with_scope_images(&opened.scope_id, |_, images| images.issue("a.png"))
            .unwrap();
        let workspace_scope = state.scope_id().unwrap();
        write_document(&outside.parent().unwrap().join("sub"), "b.md");

        // 同じ文書、別の文書、ワークスペース、開いていないスコープ。
        handle
            .retarget_loose(&opened.scope_id, "note.md", "tab-1", 1)
            .unwrap();
        handle
            .retarget_loose(&opened.scope_id, "sub/b.md", "tab-1", 2)
            .unwrap();
        handle
            .retarget_loose(&workspace_scope, "sub/b.md", "tab-1", 3)
            .unwrap();
        handle
            .retarget_loose("unknown", "sub/b.md", "tab-1", 4)
            .unwrap();

        assert_eq!(state.lock_loose_watchers().len(), 1);
        assert_eq!(
            state.lock_loose_watchers()[0].scope_id(),
            opened.scope_id.as_str()
        );
        assert!(handle.find_image(&id, |_, _| ()).is_some());
    }

    /// 付け替えると、以後は付け替え先の文書の変更を、同じスコープIDで送る。元の文書の変更は
    /// 送らない（監視は開いているファイル1件に限る。6.4）。
    #[test]
    fn retargeting_moves_the_watch_to_the_new_document() {
        struct RecordingSink(Mutex<Vec<(String, String)>>);
        impl ChangeSink for RecordingSink {
            fn file_change(&self, event: FileChangeEvent) {
                if let crate::ipc::types::FileChange::FileModified { path } = event.change {
                    self.0.lock().unwrap().push((event.scope_id, path));
                }
            }
            fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
            fn images_changed(&self, _scope_id: &str) {}
        }
        let (_temp, state, outside) = with_workspace_and_outside("retarget-events");
        let folder = outside.parent().unwrap().to_owned();
        let sub = write_document(&folder.join("sub"), "b.md");
        let recording = Arc::new(RecordingSink(Mutex::new(Vec::new())));
        let opened = state
            .open_loose(&outside, Arc::clone(&recording) as Arc<dyn ChangeSink>)
            .unwrap();
        let wait_for = |expected: (String, String)| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while std::time::Instant::now() < deadline {
                if recording.0.lock().unwrap().contains(&expected) {
                    return true;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            false
        };

        state
            .workspace()
            .retarget_loose(&opened.scope_id, "sub/b.md", "tab-1", 1)
            .unwrap();
        fs::write(&outside, b"# rewritten original\n").unwrap();
        fs::write(&sub, b"# rewritten target\n").unwrap();

        assert!(
            wait_for((opened.scope_id.clone(), "sub/b.md".to_owned())),
            "移った先の変更が届かない"
        );
        // 元の文書の変更は、監視を外したため届かない。
        std::thread::sleep(std::time::Duration::from_millis(600));
        assert!(
            recording
                .0
                .lock()
                .unwrap()
                .iter()
                .all(|(_, path)| path == "sub/b.md"),
            "{:?}",
            recording.0.lock().unwrap()
        );
    }

    /// 監視先を確定する要求は、同じタブでは確定済みの世代より新しいものだけを受ける。素早く
    /// リンクを辿って、古い読込の確認があとから届いても、表示中の文書の監視は動かない。別のタブ
    /// （スコープを開き直した場合）は、世代が数え直しになるため受ける。
    #[test]
    fn an_older_confirmation_does_not_move_the_watch() {
        struct RecordingSink(Mutex<Vec<String>>);
        impl ChangeSink for RecordingSink {
            fn file_change(&self, event: FileChangeEvent) {
                if let crate::ipc::types::FileChange::FileModified { path } = event.change {
                    self.0.lock().unwrap().push(path);
                }
            }
            fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
            fn images_changed(&self, _scope_id: &str) {}
        }
        let (_temp, state, outside) = with_workspace_and_outside("stale-confirmation");
        let folder = outside.parent().unwrap().to_owned();
        let sub = write_document(&folder.join("sub"), "b.md");
        let recording = Arc::new(RecordingSink(Mutex::new(Vec::new())));
        let opened = state
            .open_loose(&outside, Arc::clone(&recording) as Arc<dyn ChangeSink>)
            .unwrap();
        let handle = state.workspace();
        let wait_for = |path: &str| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while std::time::Instant::now() < deadline {
                if recording.0.lock().unwrap().iter().any(|seen| seen == path) {
                    return true;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            false
        };

        // 世代2の確認が先に届き、世代1（古い読込）の確認があとから届く。
        handle
            .retarget_loose(&opened.scope_id, "sub/b.md", "tab-1", 2)
            .unwrap();
        handle
            .retarget_loose(&opened.scope_id, "note.md", "tab-1", 1)
            .unwrap();
        fs::write(
            &outside,
            b"# rewritten original
",
        )
        .unwrap();
        fs::write(
            &sub,
            b"# rewritten target
",
        )
        .unwrap();

        assert!(wait_for("sub/b.md"), "表示中の文書の変更が届かない");
        std::thread::sleep(std::time::Duration::from_millis(600));
        assert!(
            recording
                .0
                .lock()
                .unwrap()
                .iter()
                .all(|path| path == "sub/b.md"),
            "{:?}",
            recording.0.lock().unwrap()
        );

        // 別のタブは、世代が1に戻っていても受ける。
        recording.0.lock().unwrap().clear();
        handle
            .retarget_loose(&opened.scope_id, "note.md", "tab-2", 1)
            .unwrap();
        fs::write(
            &outside,
            b"# rewritten again
",
        )
        .unwrap();
        assert!(wait_for("note.md"), "別のタブの確認が受け入れられない");
    }

    /// Watcherを開始できなかったときは、そのスコープの送出先へ監視が止まったことを知らせる。
    /// 読込の応答は成功しているため、失敗を応答へ載せない。開始の失敗は、注入した開始関数で再現する。
    #[test]
    fn a_failed_retarget_reports_that_watching_stopped() {
        struct RecordingSink(Mutex<Vec<(String, ErrorCode)>>);
        impl ChangeSink for RecordingSink {
            fn file_change(&self, _event: FileChangeEvent) {}
            fn watcher_error(&self, scope_id: &str, code: ErrorCode) {
                self.0.lock().unwrap().push((scope_id.to_owned(), code));
            }
            fn images_changed(&self, _scope_id: &str) {}
        }
        let (_temp, state, outside) = with_workspace_and_outside("retarget-failure");
        write_document(&outside.parent().unwrap().join("sub"), "b.md");
        let recording = Arc::new(RecordingSink(Mutex::new(Vec::new())));
        let opened = state
            .open_loose(&outside, Arc::clone(&recording) as Arc<dyn ChangeSink>)
            .unwrap();

        state
            .workspace()
            .retarget_loose_with(
                &opened.scope_id,
                "sub/b.md",
                "tab-1",
                1,
                &|_, _, _, _, _| Err(notify::Error::generic("開始できない")),
            )
            .unwrap();

        assert_eq!(
            *recording.0.lock().unwrap(),
            vec![(opened.scope_id, ErrorCode::WatcherStopped)]
        );
    }

    /// 付け替えの要求はFrontendから届くパスであり、暗黙のルートに対して再検証する（7.1）。
    /// 逸脱した要求は、拒否して、監視も確定した世代も変えない。
    #[test]
    fn an_invalid_target_is_rejected_and_changes_nothing() {
        struct RecordingSink(Mutex<Vec<String>>);
        impl ChangeSink for RecordingSink {
            fn file_change(&self, event: FileChangeEvent) {
                if let crate::ipc::types::FileChange::FileModified { path } = event.change {
                    self.0.lock().unwrap().push(path);
                }
            }
            fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
            fn images_changed(&self, _scope_id: &str) {}
        }
        let (temp, state, outside) = with_workspace_and_outside("invalid-target");
        // 暗黙のルートの外にあるフォルダーとファイル。
        let elsewhere = write_document(&temp.path().join("elsewhere"), "x.md");
        write_document(&outside.parent().unwrap().join("sub"), "notes.txt");
        let recording = Arc::new(RecordingSink(Mutex::new(Vec::new())));
        let opened = state
            .open_loose(&outside, Arc::clone(&recording) as Arc<dyn ChangeSink>)
            .unwrap();
        let handle = state.workspace();
        let absolute = elsewhere.to_string_lossy().into_owned();
        let cases = [
            ("親フォルダーへ出る", "../elsewhere/x.md"),
            ("途中で親へ出る", "sub/../../elsewhere/x.md"),
            ("絶対パス", absolute.as_str()),
            ("区切りがバックスラッシュ", r"sub\b.md"),
            ("Markdownではない", "sub/notes.txt"),
            ("実在しない", "sub/missing.md"),
            ("空", ""),
        ];

        for (name, path) in cases {
            // 世代は新しくしておく。検証を通らなければ、世代の比較へ進まない。
            assert!(
                handle
                    .retarget_loose(&opened.scope_id, path, "tab-1", 9)
                    .is_err(),
                "{name}: 拒否されない"
            );
        }

        // 監視は元の文書のままで、外のフォルダーは監視していない。
        fs::write(&elsewhere, b"# rewritten elsewhere\n").unwrap();
        fs::write(&outside, b"# rewritten original\n").unwrap();
        let wait_for_any = || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while recording.0.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        };
        wait_for_any();
        std::thread::sleep(std::time::Duration::from_millis(600));
        assert_eq!(
            *recording.0.lock().unwrap(),
            vec!["note.md".to_owned()],
            "外の文書の変更が届いている、または元の文書の変更が届かない"
        );

        // 拒否した要求は世代を進めない。同じ世代の、正当な要求は受け入れられる。
        let sub = write_document(&outside.parent().unwrap().join("sub"), "b.md");
        handle
            .retarget_loose(&opened.scope_id, "sub/b.md", "tab-1", 9)
            .unwrap();
        recording.0.lock().unwrap().clear();
        fs::write(&sub, b"# rewritten target\n").unwrap();
        wait_for_any();
        assert_eq!(*recording.0.lock().unwrap(), vec!["sub/b.md".to_owned()]);
    }

    /// junctionを作る。
    fn create_junction(link: &Path, target: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .status()
            .expect("mklinkを実行できない");
        assert!(status.success(), "junctionを作れない");
    }

    /// 検証のあとに、監視するフォルダーがルート外を指すjunctionへ差し替えられても、そのフォルダーを
    /// 監視し続けない（7.1）。検証で確定した場所をそのまま監視し、開始の後にもう一度確かめる。
    /// 差し替えは、検証と開始の間へ、注入した開始関数で挟む。差し替えを検出したら、監視を捨てて
    /// 拒否し、次の要求が監視を作り直せるようにする。
    #[test]
    fn a_folder_swapped_after_validation_is_not_watched() {
        struct RecordingSink(Mutex<Vec<String>>);
        impl ChangeSink for RecordingSink {
            fn file_change(&self, event: FileChangeEvent) {
                if let crate::ipc::types::FileChange::FileModified { path } = event.change {
                    self.0.lock().unwrap().push(path);
                }
            }
            fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
            fn images_changed(&self, _scope_id: &str) {}
        }
        let (temp, state, outside) = with_workspace_and_outside("swapped-folder");
        let sub_path = outside.parent().unwrap().join("sub");
        write_document(&sub_path, "b.md");
        // ルートの外にあるフォルダー。同じ名前のファイルを持つ。
        let elsewhere = temp.path().join("elsewhere");
        let external = write_document(&elsewhere, "b.md");
        let recording = Arc::new(RecordingSink(Mutex::new(Vec::new())));
        let opened = state
            .open_loose(&outside, Arc::clone(&recording) as Arc<dyn ChangeSink>)
            .unwrap();
        let handle = state.workspace();

        let swap_then_start = |root: &Path, watched: &Path, file: &str, id: String, sink| {
            // 検証を通ったあとに、下位のフォルダーをルート外を指すjunctionへ差し替える。
            fs::remove_dir_all(&sub_path).unwrap();
            create_junction(&sub_path, &elsewhere);
            LooseWatcher::start(root, watched, file, id, sink)
        };
        let error = handle
            .retarget_loose_with(&opened.scope_id, "sub/b.md", "tab-1", 1, &swap_then_start)
            .expect_err("差し替えを検出できない");
        assert!(matches!(
            error,
            ResolveError::Rejected(PathRejection::Outside)
        ));

        // 監視は残っておらず、ルート外の変更は届かない。
        assert_eq!(state.lock_loose_watchers().len(), 0);
        fs::write(&external, b"# rewritten external\n").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(600));
        assert!(recording.0.lock().unwrap().is_empty());

        // 差し替えを元へ戻すと、同じ文書の次の要求が監視を作り直す。
        fs::remove_dir(&sub_path).unwrap();
        let sub = write_document(&sub_path, "b.md");
        handle
            .retarget_loose(&opened.scope_id, "sub/b.md", "tab-1", 2)
            .unwrap();
        assert_eq!(state.lock_loose_watchers().len(), 1);
        fs::write(&sub, b"# rewritten inside\n").unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while recording.0.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(*recording.0.lock().unwrap(), vec!["sub/b.md".to_owned()]);
    }
}
