//! 画像resource IDの生成、世代、対応表（design-decisions.md 5.4）。
//!
//! IDは、ワークスペースごとの乱数のソルトを鍵とし、相対パスとその変更世代を入力とする
//! HMAC-SHA256である。対応表に無いIDは配信しない。
//!
//! 世代を進めるのはファイル監視である（`watch_runtime`）。監視が変更を検知すればIDが変わる
//! ため、配信時に長期キャッシュを返せる。監視のバッファがあふれたときは個別の変更を取り
//! こぼしているため、ソルトごと作り直して全IDを変える。

use std::collections::HashMap;
use std::sync::Mutex;

use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;

/// ソルトのバイト数。HMAC-SHA256の出力長と揃える。
const SALT_BYTES: usize = 32;

/// 1つのワークスペース（またはloose tabの暗黙のルート）に属する画像resource ID。
///
/// ワークスペースを開くたびに作り、閉じるときに捨てる。切り替え時にソルトごと破棄されるため、
/// 旧ワークスペースのIDは新しい対応表に存在せず、拒否される（5.4）。
pub struct ImageResources {
    inner: Mutex<Inner>,
}

struct Inner {
    salt: [u8; SALT_BYTES],
    /// 発行したことのあるパスの状態。キーは小文字へ揃えた相対パスである。
    ///
    /// 小文字へ揃えるのは、参照の表記と監視イベントの表記が大文字小文字で食い違っても、
    /// 同じファイルとして世代を進めるためである。Windowsのファイル名は大文字小文字を
    /// 区別しない（7.1）。
    ///
    /// 発行していないパスは持たない。監視はワークスペース内の全イベントを渡してくるが、
    /// 発行していないパスの世代は誰のIDにも影響せず、持つと表が際限なく伸びる。
    paths: HashMap<String, PathState>,
    /// IDから相対パスを引く対応表。配信時の照合に使う。
    issued: HashMap<String, String>,
}

struct PathState {
    /// 発行時に受け取った表記（ファイルシステム上の表記）。配信時に解決し直すパスである。
    path: String,
    generation: u64,
    /// 現在の世代で発行したID。世代を進めるときに対応表から外すために持つ。
    resource_id: String,
}

impl ImageResources {
    /// ソルトを生成して空の対応表を作る。
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                salt: new_salt(),
                paths: HashMap::new(),
                issued: HashMap::new(),
            }),
        }
    }

    /// 相対パスに対するIDを発行する。同じ世代の間は同じIDを返す。
    ///
    /// `relative` は実在を確かめ、ファイルシステム上の表記へ直したワークスペース相対パスで
    /// ある。境界と形式の検証は呼び出し側が済ませる（`super::issue`）。
    pub fn issue(&self, relative: &str) -> String {
        let mut inner = self.lock();
        let key = relative.to_lowercase();
        if let Some(state) = inner.paths.get(&key) {
            return state.resource_id.clone();
        }
        let resource_id = resource_id(&inner.salt, &key, 0);
        inner
            .issued
            .insert(resource_id.clone(), relative.to_owned());
        inner.paths.insert(
            key,
            PathState {
                path: relative.to_owned(),
                generation: 0,
                resource_id: resource_id.clone(),
            },
        );
        resource_id
    }

    /// IDに対応する相対パスを返す。対応表に無ければ `None` を返す。
    pub fn lookup(&self, resource_id: &str) -> Option<String> {
        self.lock().issued.get(resource_id).cloned()
    }

    /// 監視が変更を検知したパスの世代を進める。
    ///
    /// `changed` と同じパスに加え、その配下のパスも進める。監視イベントからはファイルと
    /// ディレクトリを区別できず（6.4）、フォルダーのrenameや削除では配下のファイルごとの
    /// イベントが届かないためである。進めなければ、同じ相対パスへ別のファイルが現れたとき、
    /// 旧IDのキャッシュが別の内容として表示される。
    ///
    /// 旧IDは対応表から外し、新しい世代のIDへ差し替える。
    pub fn advance(&self, changed: &str) {
        let mut inner = self.lock();
        let changed = changed.to_lowercase();
        let Inner {
            salt,
            paths,
            issued,
        } = &mut *inner;
        for (key, state) in paths.iter_mut() {
            if !is_same_or_under(key, &changed) {
                continue;
            }
            issued.remove(&state.resource_id);
            state.generation += 1;
            state.resource_id = resource_id(salt, key, state.generation);
            issued.insert(state.resource_id.clone(), state.path.clone());
        }
    }

    /// ソルトを作り直し、対応表を破棄する。監視のバッファがあふれたときに呼ぶ（5.4）。
    pub fn reset(&self) {
        let mut inner = self.lock();
        inner.salt = new_salt();
        inner.paths.clear();
        inner.issued.clear();
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        // ロックが毒された時点で状態の一貫性は失われている。`panic = "abort"` の下では
        // 毒される経路自体が生じないため、回復は試みない（12章）。
        self.inner.lock().expect("画像resource IDのロックに失敗")
    }
}

impl Default for ImageResources {
    fn default() -> Self {
        Self::new()
    }
}

fn new_salt() -> [u8; SALT_BYTES] {
    let mut salt = [0; SALT_BYTES];
    // OSの乱数源が使えない環境では、推測できないIDを作れない。予測可能な値で代替すると
    // 5.4の前提（相対パスを知っていてもIDを算出できない）が黙って崩れるため、落とす。
    getrandom::fill(&mut salt).expect("OSの乱数源からソルトを取得できない");
    salt
}

/// `salt` を鍵として、パスと世代からIDを作る。
///
/// パスと世代の境界を曖昧にしないため、パスの後に区切りのNULを挟む。相対パスはNULを
/// 含まない（7.1）。出力は小文字の16進とし、sanitize schemaが許すIDの形
/// （`[A-Za-z0-9_-]+`。8.2）に収める。
fn resource_id(salt: &[u8], key: &str, generation: u64) -> String {
    let mut mac =
        <Hmac<Sha256> as KeyInit>::new_from_slice(salt).expect("HMACは任意長の鍵を受け付ける");
    mac.update(key.as_bytes());
    mac.update(&[0]);
    mac.update(&generation.to_be_bytes());
    mac.finalize()
        .into_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// `path` が `changed` と同じか、その配下にあるかを返す。`/` 区切りのコンポーネント単位で
/// 比べる。前方一致では `img` の変更で `img2/a.png` まで進めてしまう。
fn is_same_or_under(path: &str, changed: &str) -> bool {
    path == changed
        || path
            .strip_prefix(changed)
            .is_some_and(|rest| rest.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 同じ世代の間は同じIDを返し、対応表から発行時の表記を引ける。
    #[test]
    fn an_issued_id_is_stable_and_resolves_to_the_path() {
        let resources = ImageResources::new();
        let id = resources.issue("docs/Image.png");

        assert_eq!(resources.issue("docs/Image.png"), id);
        // 表記の大文字小文字が違っても同じファイルである（7.1）。
        assert_eq!(resources.issue("DOCS/image.PNG"), id);
        assert_eq!(resources.lookup(&id).as_deref(), Some("docs/Image.png"));
        // sanitize schemaが許すIDの形に収まる（8.2）。
        assert_eq!(id.len(), 64);
        assert!(id.bytes().all(|byte| byte.is_ascii_hexdigit()));
    }

    /// 対応表に無いIDは引けない（5.4）。
    #[test]
    fn an_unknown_id_is_not_resolved() {
        let resources = ImageResources::new();
        resources.issue("a.png");
        assert_eq!(resources.lookup("0".repeat(64).as_str()), None);
        assert_eq!(resources.lookup(""), None);
    }

    /// ソルトはワークスペースごとに異なり、同じ相対パスでも別のIDになる。
    ///
    /// 相対パスを知っているだけではIDを算出できないこと（5.4）の裏返しである。
    #[test]
    fn workspaces_do_not_share_ids() {
        let first = ImageResources::new();
        let second = ImageResources::new();
        let id = first.issue("a.png");

        assert_ne!(second.issue("a.png"), id);
        assert_eq!(second.lookup(&id), None);
    }

    /// 変更を検知したパスとその配下の世代を進め、旧IDを拒否する。
    ///
    /// 監視イベントはファイルとディレクトリを区別できず、フォルダーのrenameでは配下の
    /// イベントが届かない（6.4）。コンポーネント単位で比べ、隣接する名前は進めない。
    #[test]
    fn advancing_changes_the_ids_of_the_path_and_its_descendants() {
        let cases = [
            ("a.png", "a.png", true),
            ("img/a.png", "img", true),
            ("img/sub/a.png", "img", true),
            // 監視イベントの表記が参照と大文字小文字で食い違っても進める。
            ("img/a.png", "IMG/A.png", true),
            ("img2/a.png", "img", false),
            ("img/a.png", "img/a", false),
            ("a.png", "b.png", false),
            ("img/a.png", "img/a.png/x", false),
        ];
        for (issued, changed, expected) in cases {
            let resources = ImageResources::new();
            let before = resources.issue(issued);

            resources.advance(changed);
            let after = resources.issue(issued);

            assert_eq!(after != before, expected, "{issued} を {changed} の変更で");
            assert_eq!(
                resources.lookup(&before).is_some(),
                !expected,
                "{issued} の旧IDの扱い（{changed} の変更）"
            );
            assert_eq!(resources.lookup(&after).as_deref(), Some(issued));
        }
    }

    /// 世代は進めるたびに新しいIDになり、過去の世代のIDへ戻らない。
    #[test]
    fn every_advance_yields_a_new_id() {
        let resources = ImageResources::new();
        let mut seen = vec![resources.issue("a.png")];
        for _ in 0..3 {
            resources.advance("a.png");
            let id = resources.issue("a.png");
            assert!(!seen.contains(&id), "過去のIDへ戻った");
            seen.push(id);
        }
    }

    /// 発行していないパスの変更は表を伸ばさない。
    #[test]
    fn changes_to_unissued_paths_are_not_tracked() {
        let resources = ImageResources::new();
        for index in 0..100 {
            resources.advance(&format!("f{index}.md"));
        }
        assert!(resources.lock().paths.is_empty());
        assert!(resources.lock().issued.is_empty());
    }

    /// あふれたときはソルトごと作り直し、全IDを変える（5.4）。
    #[test]
    fn resetting_invalidates_every_id() {
        let resources = ImageResources::new();
        let a = resources.issue("a.png");
        let b = resources.issue("docs/b.png");

        resources.reset();

        assert_eq!(resources.lookup(&a), None);
        assert_eq!(resources.lookup(&b), None);
        // 世代は0から数え直すが、ソルトが変わるため同じIDにはならない。
        assert_ne!(resources.issue("a.png"), a);
        assert_ne!(resources.issue("docs/b.png"), b);
    }
}
