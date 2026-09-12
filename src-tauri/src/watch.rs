//! ファイル監視の時間に関する定数、`notify` のイベントの写像、debounce窓の畳み込み規則。
//!
//! ライフサイクルは design-decisions.md 6.4、6.5 を正本とする。Watcherの起動と停止、
//! 監視スコープの採番は4-1dの後半で行う。ここが持つのは、実際の監視から切り離して
//! 検証できる部分に限る。時計は呼び出し側が渡し、このモジュールは時刻を読まない。

use std::path::Path;

use notify::Event;
use notify::event::{EventKind, ModifyKind, RenameMode};

use crate::ipc::types::FileChange;
use crate::path_guard::relativize_literal;

/// debounceの窓（ミリ秒）。
///
/// 単一の書込みに対しても `Create` と複数の `Modify` が届き、atomic replaceでは
/// 置換先へ `Remove` が先行する（design-decisions.md 6.4の実測）。debounceは実装上の
/// 最適化ではなく、削除とrenameを誤判定しないために必要である。
///
/// 長くすると再描画が遅れ、短くするとatomic replaceの `Remove` を削除と誤判定する確率が
/// 上がる。150 msを実測で確定した（design-decisions.md 6.4）。連続書込み中のイベント間隔は
/// 最大17 ms、50 ms間隔のatomic replaceでも最大52 msであり、置換の列を1つの窓へ収める
/// 余裕がある。
pub const DEBOUNCE_MS: u64 = 150;

/// 置換直後の読込失敗に対して許す再読込の回数（design-decisions.md 6.5）。
///
/// 「共有違反時に自動リトライしない」という原則の限定的な例外であり、同一イベントに
/// 対して1回だけ許す。回数を増やすと、実際に他プロセスがロックし続けている状況で
/// 失敗の提示が遅れる。
pub const REPLACE_RETRY_LIMIT: u32 = 1;

/// 再読込までの待ち時間（ミリ秒）。
///
/// 100 msを据え置きで確定した。2000回のatomic replaceと並行して読み続けても読込は
/// 1件も失敗せず、この待ち時間を実測から導けなかった（design-decisions.md 6.4）。
/// 再現しなかったことを理由に再読込そのものを落とすことはしない。実測したのはRust同士の
/// 書き手と読み手であり、置換直後にファイルを掴む第三者（ウイルス対策ソフトなど）を
/// 含む経路は再現できていない。
pub const REPLACE_RETRY_DELAY_MS: u64 = 100;

// 再読込の待ちはdebounceの窓に収まらなければならない。窓より長いと、次のdebounceが
// 確定した後に前の再読込を開始することになる。値を動かしたときに関係が崩れないよう
// コンパイル時に固定する。
const _: () = assert!(REPLACE_RETRY_DELAY_MS < DEBOUNCE_MS);

/// 1つの窓を開いていられる最長時間（ミリ秒）。
///
/// 窓は最後のイベントから `DEBOUNCE_MS` の静穏で閉じる。最初のイベントからの固定窓に
/// しないのは、atomic replaceの列（`Remove` のあとに `Modify(Name(To))` が続く）が窓を
/// またぐと、先の窓が `FileRemoved` を確定させてタブを終端状態の `deleted` にしてしまう
/// ためである（design-decisions.md 6.5）。
///
/// 一方で静穏だけを条件にすると、書込みが続く間は窓が閉じず表示が更新されない。この上限で
/// 強制的に閉じる。
///
/// 上限で閉じても未確定の削除は確定させない。通知の期限と削除の確定は別であり、猶予中の
/// 保留に関わるイベントは次の窓へ持ち越す（`DebounceWindow::take_due`）。期限を延ばす形で
/// 解こうとすると、古い保留が新しい削除の猶予を食うか、無関係な更新で窓が延び続けるかの
/// どちらかになる。
///
/// 600 msを据え置きで確定した。200回の連続書込みではイベントの配送が904 ms続き、1回の
/// バーストが窓をまたぐ（design-decisions.md 6.4の実測）。それでも上限を伸ばさないのは、
/// 上限が「書込みが続く間も表示を更新する」ための保険だからである。窓が分かれること自体は
/// 持ち越しの規則が許容しており削除の誤判定は起きない。伸ばすと最悪の更新遅延がそのまま
/// 伸び、[spec.md](../../docs/spec.md) 5.1の変更反映の目標から遠ざかる。
pub const MAX_WINDOW_MS: u64 = 600;

// 上限は静穏の窓より長くなければならない。短いと静穏による確定へ到達しない。
const _: () = assert!(MAX_WINDOW_MS > DEBOUNCE_MS);

/// 1つの窓で個別の変更として確定させるイベント数の上限（design-decisions.md 6.4）。
///
/// `notify` のWindowsバックエンドは、`ReadDirectoryChangesW` のバッファに収まらなかった
/// ことを呼び出し側へ伝えない。完了ルーチンは `bytes_written` を読まず、イベントは黙って
/// 欠落する。したがって、あふれたという事実を検知する手立てはない。
///
/// そこであふれの検知に依存せず、1つの窓に入るイベント数で縮退させる。上限を超えた窓は
/// 個別の変更を確定させず、`ErrorCode::WatcherOverflow` として「展開済みディレクトリの
/// 再取得とアクティブ文書の再読込」へ倒す。実際にあふれたかどうかによらず結果が同じに
/// なるため、検知の正確さに依存しない。
///
/// 1024とする。実測では600 msの窓あたり、連続書込みで約265件、5000ファイルの一括作成で
/// 約2300件が届く。前者は通常の書込みであり縮退させたくない。後者の規模になると、個別の
/// 変更を1件ずつ通知するより展開済みの階層を取り直すほうが安い。
pub const MAX_EVENTS_PER_WINDOW: usize = 1024;

// 上限は、通常の書込みで届く件数（実測で約265件）より十分大きくなければならない。
// 近いと、エディタの連続保存のたびに縮退して警告が出る。
const _: () = assert!(MAX_EVENTS_PER_WINDOW > 512);

/// debounce窓へ入る生イベントの種別。
///
/// `notify` の `EventKind` から写像する。`notify` の型をそのまま扱わないのは、
/// 畳み込みの規則をプラットフォームとcrateのバージョンから切り離してテストするためである。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawEventKind {
    Created,
    Modified,
    Removed,
    /// rename元。`Modify(Name(From))` に対応する。
    RenamedFrom,
    /// rename先。`Modify(Name(To))` に対応する。
    RenamedTo,
}

/// debounce窓へ入る生イベント。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawEvent {
    pub kind: RawEventKind,
    /// スコープのルートからの相対パス。
    pub path: String,
}

impl RawEvent {
    pub fn new(kind: RawEventKind, path: &str) -> Self {
        Self {
            kind,
            path: path.to_owned(),
        }
    }
}

/// `notify` のイベントを、窓へ入れる生イベントへ写す。
///
/// `root` はスコープのルートであり、`canonicalize` 済みの絶対パスである。相対化できない
/// パス（境界外、走査が落とす名前、不正なUTF-16）を運ぶイベントは捨てる。通知しても
/// そのまま走査と読込へ渡せないためである。
///
/// | `EventKind` | 生イベント |
/// | --- | --- |
/// | `Create(_)` | `Created` |
/// | `Remove(_)` | `Removed` |
/// | `Modify(Name(From))` | `RenamedFrom` |
/// | `Modify(Name(To))` | `RenamedTo` |
/// | `Modify(Name(Both))` | `RenamedFrom` と `RenamedTo`（`paths` の順） |
/// | `Modify(その他)`、`Any`、`Other` | `Modified` |
/// | `Access(_)` | 捨てる |
///
/// 分類できない種別を `Modified` へ倒すのは、`Removed` へ倒すとタブが終端状態の `deleted`
/// になり、実際にはファイルが残っていても復帰できないためである（design-decisions.md 6.5）。
/// `Modified` なら再読込が走り、本当に失われていれば読込の失敗として原因が出る。`Access`
/// だけは内容もツリーも変えないため捨てる。
pub fn map_event(root: &Path, event: &Event) -> Vec<RawEvent> {
    match event.kind {
        EventKind::Create(_) => all_paths(root, event, RawEventKind::Created),
        EventKind::Remove(_) => all_paths(root, event, RawEventKind::Removed),
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
            all_paths(root, event, RawEventKind::RenamedFrom)
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
            all_paths(root, event, RawEventKind::RenamedTo)
        }
        // 1つのイベントが旧パスと新パスの両方を運ぶ場合。`paths` は旧・新の順である。
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => [
            path_at(root, event, 0, RawEventKind::RenamedFrom),
            path_at(root, event, 1, RawEventKind::RenamedTo),
        ]
        .into_iter()
        .flatten()
        .collect(),
        EventKind::Modify(_) | EventKind::Any | EventKind::Other => {
            all_paths(root, event, RawEventKind::Modified)
        }
        EventKind::Access(_) => Vec::new(),
    }
}

/// イベントが運ぶすべてのパスを、同じ種別の生イベントへ写す。
fn all_paths(root: &Path, event: &Event, kind: RawEventKind) -> Vec<RawEvent> {
    event
        .paths
        .iter()
        .filter_map(|path| relativize_literal(root, path))
        .map(|path| RawEvent { kind, path })
        .collect()
}

/// イベントが運ぶ `index` 番目のパスを生イベントへ写す。
fn path_at(root: &Path, event: &Event, index: usize, kind: RawEventKind) -> Option<RawEvent> {
    let path = relativize_literal(root, event.paths.get(index)?)?;
    Some(RawEvent { kind, path })
}

/// 窓を閉じたときの結果。
///
/// 縮退したことを真偽値で持たせず、確定した列と排他にする。縮退した窓のイベントは
/// 捨てており、個別の変更として使ってはならない。両方を同時に返せる形にすると、
/// 呼び出し側が捨てるべき列を読む経路が型として残る（`FileChange` と同じ理由）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WindowOutcome {
    /// 確定した生イベント。`coalesce` へ渡す。
    Events(Vec<RawEvent>),
    /// 1つの窓のイベント数が `MAX_EVENTS_PER_WINDOW` を超えたため縮退した。
    ///
    /// 呼び出し側は個別の変更を通知せず、`ErrorCode::WatcherOverflow` として
    /// 展開済みディレクトリの再取得とアクティブ文書の再読込へ倒す。
    Overflowed,
}

/// debounce窓（design-decisions.md 6.4）。
///
/// 時刻は呼び出し側が単調増加するミリ秒として渡す。ここが `Instant::now()` を読むと、
/// 窓の時間規則を実時間なしに検証できなくなる（14.2）。
#[derive(Debug, Default)]
pub struct DebounceWindow {
    /// 受け取った時刻とイベントの対。時刻は保留の猶予を測るために要る。
    events: Vec<(u64, RawEvent)>,
    opened_at_ms: u64,
    last_event_ms: u64,
    /// この窓が `MAX_EVENTS_PER_WINDOW` を超えたか。
    overflowed: bool,
}

impl DebounceWindow {
    pub fn new() -> Self {
        Self::default()
    }

    /// 窓へイベントを入れる。空の窓なら、このイベントで窓が開く。
    ///
    /// 上限を超えた窓は縮退し、以後のイベントを溜めない。溜めたところで個別の変更としては
    /// 使わないうえ、大量のイベントが届き続ける状況ではメモリだけが伸びる。
    pub fn push(&mut self, now_ms: u64, event: RawEvent) {
        if !self.is_open() {
            self.opened_at_ms = now_ms;
        }
        self.last_event_ms = now_ms;
        if self.overflowed {
            return;
        }
        self.events.push((now_ms, event));
        if self.events.len() > MAX_EVENTS_PER_WINDOW {
            self.overflowed = true;
            self.events.clear();
        }
    }

    /// 窓が開いているか。縮退した窓はイベントを捨てているが、期限が来るまでは開いている。
    fn is_open(&self) -> bool {
        !self.events.is_empty() || self.overflowed
    }

    /// 窓を閉じる時刻。開いていなければ `None` を返す。
    ///
    /// 最後のイベントからの静穏（`DEBOUNCE_MS`）で閉じ、書込みが続く間に窓が閉じず表示が
    /// 更新されないことを避けるため、開いてから `MAX_WINDOW_MS` でも閉じる。
    ///
    /// 保留があっても期限は延ばさない。延ばす形にすると、古い保留が新しい削除の猶予を
    /// 食うか、無関係なパスの更新で窓が延び続けるかのどちらかになる。未確定の削除を
    /// 確定させない役割は `take_due` の持ち越しが担う。
    pub fn deadline_ms(&self) -> Option<u64> {
        if !self.is_open() {
            return None;
        }
        let quiet = self.last_event_ms + DEBOUNCE_MS;
        Some(quiet.min(self.opened_at_ms + MAX_WINDOW_MS))
    }

    /// 窓が閉じていれば、確定させるイベントを取り出す。閉じていなければ `None` を返す。
    ///
    /// 猶予中の保留に関わるイベントは取り出さず、次の窓へ持ち越す。保留とは、この時点で
    /// 窓を閉じると `FileRemoved` を確定させてしまう状態であり、次の2つを指す。
    ///
    /// - 同じ窓で作り直されていない `Removed`。atomic replaceは `Removed` から始まるため、
    ///   これを確定させると、続く `RenamedTo` が次の窓へ回り、タブが終端状態の `deleted`
    ///   から戻らなくなる（design-decisions.md 6.5）。
    /// - 対の `RenamedTo` が届いていない `RenamedFrom`。
    ///
    /// 猶予は保留ごとに「その保留が届いた時刻」から `DEBOUNCE_MS` とする。保留ごとに測る
    /// ため、古い保留が新しい削除の猶予を食わない。猶予を過ぎた保留はそのまま取り出して
    /// 確定させるため、対の届かないrename（監視範囲外への移動）で持ち越しが続くこともない。
    ///
    /// 持ち越すのは、猶予中の保留と同じパスを持つイベントすべてとする。保留を作った
    /// イベントだけを残すと、同じ窓で受けた同じパスの変更が先に確定してしまう。
    ///
    /// 持ち越した後の窓は、**保留が届いた時刻**を起点として測り直す。持ち越したイベントの
    /// うち最も古いものを起点にすると、同じパスの古い変更（`Modified a.md` のあとに
    /// `Removed a.md` が来る列）まで持ち越したときに起点が過去のまま残り、期限が前へ
    /// 進まない。期限が動かないと `take_due` は同じ時刻で空の結果を返し続け、呼び出し側の
    /// タイマーが即時再実行を繰り返す。保留は猶予の内側にあるため、この起点なら静穏も
    /// 上限も必ず `now_ms` より後になる。
    ///
    /// 確定させるものがなく持ち越しだけが残る場合は、空の列を返す。窓が閉じたことと
    /// 確定したものがないことは別であり、呼び出し側は次の期限まで待てばよい。
    ///
    /// 縮退した窓は `WindowOutcome::Overflowed` を返し、持ち越しも行わずに窓を捨てる。
    /// 縮退の結果は展開済みディレクトリの再取得とアクティブ文書の再読込であり、保留を
    /// 引き継いでも次の窓で確定させる相手がいない。
    pub fn take_due(&mut self, now_ms: u64) -> Option<WindowOutcome> {
        if now_ms < self.deadline_ms()? {
            return None;
        }
        if self.overflowed {
            *self = Self::new();
            return Some(WindowOutcome::Overflowed);
        }
        let pending = self.pending_in_grace(now_ms);
        let (retained, due): (Vec<_>, Vec<_>) = std::mem::take(&mut self.events)
            .into_iter()
            .partition(|(_, event)| pending.iter().any(|(path, _)| *path == event.path));
        self.opened_at_ms = pending.iter().map(|(_, at)| *at).min().unwrap_or_default();
        self.last_event_ms = retained.last().map_or(0, |(at, _)| *at);
        self.events = retained;
        Some(WindowOutcome::Events(
            due.into_iter().map(|(_, event)| event).collect(),
        ))
    }

    /// 猶予の内側にある保留のパスと、それが届いた時刻。
    ///
    /// 復活の規則は `coalesce` と揃える。`coalesce` が削除を取り消す事象（同じパスの
    /// `Created`、`Modified`、`RenamedTo`）でここでも保留を外す。ここだけ緩いと、
    /// `coalesce` が `FileRemoved` を返す状態のまま窓を切ることになる。
    ///
    /// `is_tracked` は見ない。対象外のパスの削除を保留として数えても、そのイベントの
    /// 確定が `DEBOUNCE_MS` 遅れるだけであり、置換を分断する側の誤りは起きない。
    fn pending_in_grace(&self, now_ms: u64) -> Vec<(String, u64)> {
        let mut removed: Vec<(&str, u64)> = Vec::new();
        let mut renamed_from: Vec<(&str, u64)> = Vec::new();
        for (at, event) in &self.events {
            match event.kind {
                RawEventKind::Removed => removed.push((&event.path, *at)),
                RawEventKind::Created | RawEventKind::Modified => {
                    remove_first_removal(&mut removed, &event.path);
                }
                RawEventKind::RenamedFrom => renamed_from.push((&event.path, *at)),
                RawEventKind::RenamedTo => {
                    remove_first_removal(&mut removed, &event.path);
                    // 個々の対応付けは見ず、件数だけで対を消す。入れ替え（`a`→`b` と
                    // `b`→`a`）のように対応付けが定まらない列でも、対の数が揃っていれば
                    // 置換の途中ではない。
                    if !renamed_from.is_empty() {
                        renamed_from.remove(0);
                    }
                }
            }
        }
        removed
            .into_iter()
            .chain(renamed_from)
            .filter(|(_, at)| now_ms < at + DEBOUNCE_MS)
            .map(|(path, at)| (path.to_owned(), at))
            .collect()
    }
}

/// 保留中の削除から、そのパスの最初の1件を取り除く。
fn remove_first_removal(removed: &mut Vec<(&str, u64)>, path: &str) {
    if let Some(index) = removed.iter().position(|(removed, _)| *removed == path) {
        removed.remove(index);
    }
}

/// debounce窓に溜まった生イベントを、確定した変更へ畳み込む。
///
/// `is_tracked` は、そのパスがツリーの対象（`.md` / `.markdown` で、除外対象配下でない）
/// かを返す（design-decisions.md 6.2、6.3）。この判定がatomic replaceと通常のrenameを
/// 分ける。エディタとAIエージェントが使う一時ファイル（`a.md.tmp` など）は対象外であり、
/// 対象外からのrenameは「別のファイルの移動」ではなく「その場での置換」だからである。
///
/// 6.4で実測した列は次のようになる。新しいものが下になる。
///
/// ```text
/// Created     a.md.tmp
/// Modified    a.md.tmp
/// Removed     a.md
/// RenamedFrom a.md.tmp
/// RenamedTo   a.md
/// ```
///
/// rename対をそのまま `FileRenamed { old_path: "a.md.tmp", path: "a.md" }` とすると、
/// 開いている `a.md` のタブは `old_path` と一致せず再読込されない。先行する
/// `Removed a.md` を `FileRemoved` として通すと、置換のたびにタブが `deleted` になる。
/// そのため次の規則で畳み込む。
///
/// | 窓内の状況 | 確定する変更 |
/// | --- | --- |
/// | `RenamedTo P` があり、rename元が対象外 | `FileModified P`（置換） |
/// | `RenamedTo P` があり、rename元 `S` が対象で `Removed P` がない | `FileRenamed { old_path: S, path: P }` |
/// | `RenamedTo P` に `Removed P` が先行し、元 `S` が対象（上書きrename） | `FileRemoved S` と `FileModified P` |
/// | 対象のファイルが対象外の名前へ移された | `FileRemoved` |
/// | 対のrename先が届かないrename元 | `FileRemoved` |
/// | `Removed P` があり、同じ窓で `P` が作り直されない | `FileRemoved P` |
/// | `Created P` または `Modified P` だけ | `FileModified P` |
///
/// rename元が同時に2件以上保留になった窓では、どの元がどの先に対応するかをイベントの
/// 順序から決められない。誤った対応付けは無関係な2つのタブを互いのパスへ移すため、
/// その窓ではrenameの追跡をやめ、削除と置換へ倒す。
///
/// renameを確定するとき、同じ窓で受けた旧パスの変更は新パスへ引き継ぐ。旧パスのまま
/// 残すと、タブが新パスへ移った後に変更を取りこぼす。
///
/// # `DirectoryChanged`
///
/// 上の表はタブ向けの変更であり、`is_tracked` で絞る。ツリー向けの `DirectoryChanged` は
/// **絞らない**。子要素を増減させる生イベント（`Created`、`Removed`、`RenamedFrom`、
/// `RenamedTo`）の親ディレクトリに対して、対象かどうかによらず生成する。
///
/// 絞れないのは、`notify` のWindowsバックエンドがディレクトリとファイルを区別しないため
/// である。`FILE_NOTIFY_INFORMATION` は種別を運ばず、届くのは `Create(Any)` /
/// `Remove(Any)` / `Modify(Any)` と rename の対だけである（design-decisions.md 6.4の実測）。
/// `Created` は受信時点の `metadata` で判別できるが、`Removed` のパスはすでに実在せず
/// 判別できない。拡張子で推定するとフォルダー `sub.tmp` の削除を取りこぼし、ツリーが
/// 黙って古くなる。
///
/// 絞らない代償は、一時ファイル（`a.md.tmp`）の作成と削除でも親の再取得が走ることである。
/// atomic replaceの列はすべて同じ親を指すため、1つの窓につき `DirectoryChanged` は1件に
/// まとまる。
///
/// `Modified` は親を出さない。内容が変わっても、その階層の子要素は増減しないためである。
/// 監視ルートの直下で書込みが続くと、親ディレクトリのタイムスタンプ更新が `Modify(Any)`
/// として大量に届く（実測）。これを子要素の増減として扱うと、書込みのたびに再走査が走る。
pub fn coalesce(events: &[RawEvent], is_tracked: impl Fn(&str) -> bool) -> Vec<FileChange> {
    let mut changes: Vec<FileChange> = Vec::new();
    // 削除は、同じ窓の中で置換やrename先として復活しうるため、窓を閉じるまで確定させない。
    let mut removed: Vec<String> = Vec::new();
    let mut modified: Vec<String> = Vec::new();
    // 対のrename先をまだ受け取っていないrename元。
    let mut pending_from: Vec<String> = Vec::new();
    // 保留中のrename元が2件以上になった窓では、どの元がどの先に対応するかをイベントの
    // 順序から決められない。誤って対応付けると無関係な2つのタブが互いのパスへ移るため、
    // 以後この窓ではrenameの追跡をやめ、削除と置換へ倒す。
    let mut ambiguous_rename = false;

    for event in events {
        match event.kind {
            RawEventKind::RenamedFrom => {
                push_once(&mut pending_from, &event.path);
                if pending_from.len() > 1 {
                    ambiguous_rename = true;
                }
            }
            RawEventKind::RenamedTo => {
                let source = if ambiguous_rename {
                    // 入れ替え（`a`→`b` と `b`→`a`）では、rename先が保留中のrename元に
                    // 現れる。失われてはいないため、保留から外して削除にしない。
                    remove_first(&mut pending_from, &event.path);
                    None
                } else {
                    pending_from.pop()
                };
                let source = source.filter(|s| is_tracked(s));
                if !is_tracked(&event.path) {
                    // 対象のファイルが対象外の名前へ移された場合は、消えたものとして扱う。
                    if let Some(source) = source {
                        remove_first(&mut modified, &source);
                        push_once(&mut removed, &source);
                    }
                    continue;
                }
                let replaced = remove_first(&mut removed, &event.path);
                match source {
                    Some(source) if !replaced => {
                        // 同じ窓で旧パスの変更を受けていた場合は、新パスの変更として引き継ぐ。
                        // 旧パスのまま残すと、タブが新パスへ移った後に変更を取りこぼす。
                        if remove_first(&mut modified, &source) {
                            push_once(&mut modified, &event.path);
                        }
                        changes.push(FileChange::FileRenamed {
                            path: event.path.clone(),
                            old_path: source,
                        });
                    }
                    // 対象のファイルを既存のファイルへ上書きrenameした場合。
                    // 移動元は失われるため、置換と削除の両方を通知する。
                    Some(source) => {
                        remove_first(&mut modified, &source);
                        push_once(&mut removed, &source);
                        push_once(&mut modified, &event.path);
                    }
                    None => push_once(&mut modified, &event.path),
                }
            }
            RawEventKind::Removed => {
                if is_tracked(&event.path) {
                    remove_first(&mut modified, &event.path);
                    push_once(&mut removed, &event.path);
                }
            }
            RawEventKind::Created | RawEventKind::Modified => {
                if is_tracked(&event.path) {
                    remove_first(&mut removed, &event.path);
                    push_once(&mut modified, &event.path);
                }
            }
        }
    }

    // 対のrename先が届かなかったrename元は、監視範囲外への移動やイベントの取りこぼしで
    // ある。いずれも旧パスからは失われているため、削除として確定する。捨ててしまうと、
    // 開いているタブが `loaded` のまま残り、ツリーも削除を反映できない。
    for path in pending_from {
        if is_tracked(&path) {
            remove_first(&mut modified, &path);
            push_once(&mut removed, &path);
        }
    }

    for path in removed {
        changes.push(FileChange::FileRemoved { path });
    }
    for path in modified {
        changes.push(FileChange::FileModified { path });
    }
    for path in changed_directories(events) {
        changes.push(FileChange::DirectoryChanged { path });
    }
    changes
}

/// 子要素が増減した可能性のあるディレクトリを、生イベントの親から集める。
///
/// `is_tracked` では絞らない。理由は `coalesce` のドキュメントを参照。
fn changed_directories(events: &[RawEvent]) -> Vec<String> {
    let mut directories: Vec<String> = Vec::new();
    for event in events {
        match event.kind {
            RawEventKind::Created
            | RawEventKind::Removed
            | RawEventKind::RenamedFrom
            | RawEventKind::RenamedTo => push_once(&mut directories, parent_of(&event.path)),
            RawEventKind::Modified => {}
        }
    }
    directories
}

/// スコープ相対パスの親ディレクトリ。ルート直下の親は空文字列（ルート自身）になる。
fn parent_of(path: &str) -> &str {
    match path.rfind('/') {
        Some(index) => &path[..index],
        None => "",
    }
}

/// 値が入っていれば取り除き、取り除いたかを返す。
fn remove_first(paths: &mut Vec<String>, path: &str) -> bool {
    match paths.iter().position(|p| p == path) {
        Some(index) => {
            paths.remove(index);
            true
        }
        None => false,
    }
}

fn push_once(paths: &mut Vec<String>, path: &str) {
    if !paths.iter().any(|p| p == path) {
        paths.push(path.to_owned());
    }
}

#[cfg(test)]
mod tests {
    use super::RawEventKind::{Created, Modified, Removed, RenamedFrom, RenamedTo};
    use super::*;

    /// ツリーの対象判定。除外対象（6.2）配下かどうかは、ここでは扱わない。
    fn is_markdown(path: &str) -> bool {
        crate::file_kind::is_markdown_path(path)
    }

    fn modified_change(path: &str) -> FileChange {
        FileChange::FileModified {
            path: path.to_owned(),
        }
    }

    fn removed_change(path: &str) -> FileChange {
        FileChange::FileRemoved {
            path: path.to_owned(),
        }
    }

    fn directory_change(path: &str) -> FileChange {
        FileChange::DirectoryChanged {
            path: path.to_owned(),
        }
    }

    /// 窓が閉じたときに確定した生イベントを取り出す。
    ///
    /// 縮退は専用のテストで検証するため、ここでは起きない前提で扱う。起きた場合は
    /// 黙って空の列にせず落とす。
    fn take_events(window: &mut DebounceWindow, now_ms: u64) -> Option<Vec<RawEvent>> {
        match window.take_due(now_ms) {
            Some(WindowOutcome::Events(events)) => Some(events),
            Some(WindowOutcome::Overflowed) => panic!("縮退しない窓で縮退した"),
            None => None,
        }
    }

    #[test]
    fn coalesce_follows_the_rules() {
        let cases: [(&str, Vec<RawEvent>, Vec<FileChange>); 8] = [
            (
                // design-decisions.md 6.4 で実測した列。
                "atomic replaceは置換先の変更へ畳み込む",
                vec![
                    RawEvent::new(Created, "a.md.tmp"),
                    RawEvent::new(Modified, "a.md.tmp"),
                    RawEvent::new(Removed, "a.md"),
                    RawEvent::new(RenamedFrom, "a.md.tmp"),
                    RawEvent::new(RenamedTo, "a.md"),
                ],
                vec![modified_change("a.md")],
            ),
            (
                "単一の書込みは1件の変更になる",
                vec![
                    RawEvent::new(Created, "a.md"),
                    RawEvent::new(Modified, "a.md"),
                    RawEvent::new(Modified, "a.md"),
                ],
                vec![modified_change("a.md")],
            ),
            (
                "対象どうしのrenameは追跡する",
                vec![
                    RawEvent::new(RenamedFrom, "a.md"),
                    RawEvent::new(RenamedTo, "b.md"),
                ],
                vec![FileChange::FileRenamed {
                    path: "b.md".to_owned(),
                    old_path: "a.md".to_owned(),
                }],
            ),
            (
                "既存ファイルへの上書きrenameは移動元の削除と置換先の変更になる",
                vec![
                    RawEvent::new(Removed, "b.md"),
                    RawEvent::new(RenamedFrom, "a.md"),
                    RawEvent::new(RenamedTo, "b.md"),
                ],
                vec![removed_change("a.md"), modified_change("b.md")],
            ),
            (
                "rename先が続かない削除は削除として確定する",
                vec![RawEvent::new(Removed, "a.md")],
                vec![removed_change("a.md")],
            ),
            (
                "削除のあとに作り直された場合は変更として確定する",
                vec![
                    RawEvent::new(Removed, "a.md"),
                    RawEvent::new(Created, "a.md"),
                ],
                vec![modified_change("a.md")],
            ),
            (
                "対象外の名前へ移されたファイルは削除として扱う",
                vec![
                    RawEvent::new(RenamedFrom, "a.md"),
                    RawEvent::new(RenamedTo, "a.md.bak"),
                ],
                vec![removed_change("a.md")],
            ),
            (
                // ツリー向けの `DirectoryChanged` は別に出る。一時ファイルの作成を
                // 子要素の増減と区別できないためである（`coalesce` のドキュメント）。
                "対象外のファイルだけの変更はタブ向けの通知を生まない",
                vec![
                    RawEvent::new(Created, "a.md.tmp"),
                    RawEvent::new(Modified, "a.md.tmp"),
                ],
                vec![],
            ),
        ];

        for (name, events, expected) in cases {
            assert_eq!(
                coalesce(&events, is_markdown),
                with_root_change(expected),
                "{name}"
            );
        }
    }

    /// タブ向けの期待値へ、ルート直下のツリー通知を足す。
    ///
    /// `coalesce` の事例はいずれもルート直下で起き、子要素を増減させる生イベントを
    /// 含むため、ツリー向けの通知はルート1件になる。生成の規則そのものは
    /// `coalesce_reports_changed_directories_without_filtering` で固定する。
    fn with_root_change(mut expected: Vec<FileChange>) -> Vec<FileChange> {
        expected.push(directory_change(""));
        expected
    }

    #[test]
    fn coalesce_handles_incomplete_and_multiple_renames() {
        let cases: [(&str, Vec<RawEvent>, Vec<FileChange>); 5] = [
            (
                // 監視範囲外への移動やイベントの取りこぼしでrename先が届かない場合。
                // 旧パスからは失われているため、削除として確定する。
                "対のrename先が届かないrename元は削除として確定する",
                vec![RawEvent::new(RenamedFrom, "a.md")],
                vec![removed_change("a.md")],
            ),
            (
                "rename先が届かないrename元は同じ窓の変更も打ち消す",
                vec![
                    RawEvent::new(Modified, "a.md"),
                    RawEvent::new(RenamedFrom, "a.md"),
                ],
                vec![removed_change("a.md")],
            ),
            (
                // 対応付けを誤ると、無関係な2つのタブが互いのパスへ移る。
                // 入れ替えではパスが元に戻るため、両方を変更として扱う。
                "同一窓の入れ替えrenameは両方の変更として扱う",
                vec![
                    RawEvent::new(RenamedFrom, "a.md"),
                    RawEvent::new(RenamedFrom, "b.md"),
                    RawEvent::new(RenamedTo, "b.md"),
                    RawEvent::new(RenamedTo, "a.md"),
                ],
                vec![modified_change("b.md"), modified_change("a.md")],
            ),
            (
                "同一窓の複数renameは削除と作成へ倒す",
                vec![
                    RawEvent::new(RenamedFrom, "a.md"),
                    RawEvent::new(RenamedFrom, "b.md"),
                    RawEvent::new(RenamedTo, "c.md"),
                    RawEvent::new(RenamedTo, "d.md"),
                ],
                vec![
                    removed_change("a.md"),
                    removed_change("b.md"),
                    modified_change("c.md"),
                    modified_change("d.md"),
                ],
            ),
            (
                // 複数のatomic replaceが同じ窓に入る場合。rename元はいずれも対象外の
                // 一時ファイルであり、削除として確定させてはならない。
                "同一窓の複数atomic replaceはそれぞれの置換先の変更になる",
                vec![
                    RawEvent::new(Removed, "a.md"),
                    RawEvent::new(Removed, "b.md"),
                    RawEvent::new(RenamedFrom, "a.md.tmp"),
                    RawEvent::new(RenamedFrom, "b.md.tmp"),
                    RawEvent::new(RenamedTo, "a.md"),
                    RawEvent::new(RenamedTo, "b.md"),
                ],
                vec![modified_change("a.md"), modified_change("b.md")],
            ),
        ];

        for (name, events, expected) in cases {
            assert_eq!(
                coalesce(&events, is_markdown),
                with_root_change(expected),
                "{name}"
            );
        }
    }

    /// renameと同じ窓で受けた旧パスの変更を、新パスへ引き継ぐことを固定する。
    ///
    /// 旧パスのまま返すと、Frontendはタブを新パスへ移したあとに旧パスの変更を捨て、
    /// 変更後の内容を再読込しない。
    #[test]
    fn coalesce_carries_modification_to_the_new_path() {
        let cases: [(&str, Vec<RawEvent>, Vec<FileChange>); 2] = [
            (
                "変更のあとにrenameされた場合",
                vec![
                    RawEvent::new(Modified, "a.md"),
                    RawEvent::new(RenamedFrom, "a.md"),
                    RawEvent::new(RenamedTo, "b.md"),
                ],
                vec![
                    FileChange::FileRenamed {
                        path: "b.md".to_owned(),
                        old_path: "a.md".to_owned(),
                    },
                    modified_change("b.md"),
                ],
            ),
            (
                "変更がなければrenameだけを返す",
                vec![
                    RawEvent::new(RenamedFrom, "a.md"),
                    RawEvent::new(RenamedTo, "b.md"),
                ],
                vec![FileChange::FileRenamed {
                    path: "b.md".to_owned(),
                    old_path: "a.md".to_owned(),
                }],
            ),
        ];

        for (name, events, expected) in cases {
            assert_eq!(
                coalesce(&events, is_markdown),
                with_root_change(expected),
                "{name}"
            );
        }
    }

    /// `notify` のイベントを組み立てる。`paths` はスコープのルート配下の絶対パスとする。
    fn notify_event(kind: EventKind, root: &Path, names: &[&str]) -> Event {
        Event {
            kind,
            paths: names.iter().map(|name| root.join(name)).collect(),
            attrs: notify::event::EventAttributes::new(),
        }
    }

    #[test]
    fn notify_events_map_to_raw_events() {
        use notify::event::{AccessKind, CreateKind, DataChange, MetadataKind, RemoveKind};

        let root = Path::new(r"C:\root");
        let cases: [(&str, EventKind, Vec<&str>, Vec<RawEvent>); 8] = [
            (
                "作成",
                EventKind::Create(CreateKind::File),
                vec!["a.md"],
                vec![RawEvent::new(Created, "a.md")],
            ),
            (
                "削除",
                EventKind::Remove(RemoveKind::File),
                vec!["docs/a.md"],
                vec![RawEvent::new(Removed, "docs/a.md")],
            ),
            (
                "内容の変更",
                EventKind::Modify(ModifyKind::Data(DataChange::Content)),
                vec!["a.md"],
                vec![RawEvent::new(Modified, "a.md")],
            ),
            (
                "rename元",
                EventKind::Modify(ModifyKind::Name(RenameMode::From)),
                vec!["a.md"],
                vec![RawEvent::new(RenamedFrom, "a.md")],
            ),
            (
                "rename先",
                EventKind::Modify(ModifyKind::Name(RenameMode::To)),
                vec!["b.md"],
                vec![RawEvent::new(RenamedTo, "b.md")],
            ),
            (
                // 1つのイベントが旧パスと新パスの両方を運ぶ場合。`paths` は旧・新の順。
                "旧新を1件で運ぶrename",
                EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
                vec!["a.md", "b.md"],
                vec![
                    RawEvent::new(RenamedFrom, "a.md"),
                    RawEvent::new(RenamedTo, "b.md"),
                ],
            ),
            (
                // 内容もツリーも変えないため捨てる。
                "読み取りアクセス",
                EventKind::Access(AccessKind::Read),
                vec!["a.md"],
                vec![],
            ),
            (
                // 分類できない種別は `Modified` へ倒す。`Removed` へ倒すとタブが終端状態の
                // `deleted` になり、ファイルが残っていても復帰できない（6.5）。
                "分類できない変更",
                EventKind::Modify(ModifyKind::Metadata(MetadataKind::Any)),
                vec!["a.md"],
                vec![RawEvent::new(Modified, "a.md")],
            ),
        ];

        for (name, kind, names, expected) in cases {
            let event = notify_event(kind, root, &names);
            assert_eq!(map_event(root, &event), expected, "{name}");
        }
    }

    #[test]
    fn events_outside_the_scope_are_dropped() {
        let root = Path::new(r"C:\root");
        // 相対化できないパスは通知しない。通知してもそのまま走査と読込へ渡せない。
        let cases: [(&str, Vec<std::path::PathBuf>); 3] = [
            ("境界外", vec![std::path::PathBuf::from(r"C:\other\a.md")]),
            (
                "隣接する名前",
                vec![std::path::PathBuf::from(r"C:\rootx\a.md")],
            ),
            ("走査が落とす名前", vec![root.join("a.md.")]),
        ];
        for (name, paths) in cases {
            let event = Event {
                kind: EventKind::Modify(ModifyKind::Any),
                paths,
                attrs: notify::event::EventAttributes::new(),
            };
            assert_eq!(map_event(root, &event), Vec::new(), "{name}");
        }
    }

    #[test]
    fn an_empty_window_has_no_deadline() {
        let mut window = DebounceWindow::new();
        assert_eq!(window.deadline_ms(), None);
        assert_eq!(take_events(&mut window, u64::MAX), None);
    }

    #[test]
    fn the_window_closes_after_a_quiet_period() {
        let mut window = DebounceWindow::new();
        window.push(1_000, RawEvent::new(Modified, "a.md"));

        assert_eq!(window.deadline_ms(), Some(1_000 + DEBOUNCE_MS));
        assert_eq!(take_events(&mut window, 1_000 + DEBOUNCE_MS - 1), None);

        let events = take_events(&mut window, 1_000 + DEBOUNCE_MS).expect("静穏で窓が閉じない");
        assert_eq!(events, vec![RawEvent::new(Modified, "a.md")]);
        // 取り出したあとは窓が空になり、次のイベントで開き直す。
        assert_eq!(window.deadline_ms(), None);
    }

    #[test]
    fn each_event_extends_the_window() {
        // 固定窓にすると、atomic replaceの列が窓をまたいだときに先の窓が
        // `FileRemoved` を確定させ、タブが終端状態の `deleted` になる（6.5）。
        let mut window = DebounceWindow::new();
        window.push(0, RawEvent::new(Removed, "a.md"));
        assert_eq!(window.deadline_ms(), Some(DEBOUNCE_MS));

        window.push(100, RawEvent::new(RenamedFrom, "a.md.tmp"));
        window.push(100, RawEvent::new(RenamedTo, "a.md"));
        assert_eq!(window.deadline_ms(), Some(100 + DEBOUNCE_MS));

        assert!(take_events(&mut window, 100 + DEBOUNCE_MS - 1).is_none());
        assert_eq!(
            take_events(&mut window, 100 + DEBOUNCE_MS).map(|events| events.len()),
            Some(3)
        );
    }

    #[test]
    fn a_busy_window_closes_at_the_upper_bound() {
        // 静穏だけを条件にすると、書込みが続く間は窓が閉じず表示が更新されない。
        let mut window = DebounceWindow::new();
        let mut now = 0;
        while now < MAX_WINDOW_MS {
            window.push(now, RawEvent::new(Modified, "a.md"));
            assert!(
                take_events(&mut window, now).is_none(),
                "上限より前に閉じている: {now}"
            );
            now += DEBOUNCE_MS - 50;
        }
        window.push(MAX_WINDOW_MS, RawEvent::new(Modified, "a.md"));

        assert_eq!(window.deadline_ms(), Some(MAX_WINDOW_MS));
        assert!(
            take_events(&mut window, MAX_WINDOW_MS).is_some(),
            "上限で閉じない"
        );
    }

    /// 上限の直前に届いた `Removed` を、atomic replaceの起点として持ち越す。
    ///
    /// 持ち越さないと、上限で窓を切った時点で `FileRemoved` が確定し、次の窓へ回った
    /// `RenamedTo` の `FileModified` では終端状態の `deleted` から戻れない（6.5）。
    #[test]
    fn a_removal_near_the_upper_bound_is_carried_to_the_next_window() {
        let mut window = DebounceWindow::new();
        // 無関係なファイルの書込みが続き、窓が上限に達しようとしている。
        for now in (0..=500).step_by(100) {
            window.push(now, RawEvent::new(Modified, "busy.md"));
        }
        window.push(599, RawEvent::new(Removed, "a.md"));

        // 上限では閉じるが、猶予中の削除は確定させない。
        let due = take_events(&mut window, MAX_WINDOW_MS).expect("上限で閉じない");
        assert_eq!(
            coalesce(&due, is_markdown),
            vec![modified_change("busy.md")],
            "置換の起点となる削除を確定させている"
        );

        window.push(601, RawEvent::new(RenamedFrom, "a.md.tmp"));
        window.push(602, RawEvent::new(RenamedTo, "a.md"));

        // 持ち越した `Removed` と同じ窓に収まるため、削除ではなく置換として確定する。
        let due = take_events(&mut window, 602 + DEBOUNCE_MS).expect("持ち越した窓が閉じない");
        assert_eq!(
            coalesce(&due, is_markdown),
            vec![modified_change("a.md"), directory_change("")]
        );
    }

    /// 古い保留が、新しい削除の猶予を食わない。
    ///
    /// 猶予を窓全体で1つ持つと、期限の起点が古い保留に固定され、上限の直前に届いた
    /// 削除がそのまま確定してしまう。猶予は保留ごとに測る。
    #[test]
    fn an_old_pending_does_not_consume_the_grace_of_a_new_one() {
        let mut window = DebounceWindow::new();
        // 猶予をとうに過ぎた削除。
        window.push(0, RawEvent::new(Removed, "old.md"));
        for now in (100..=500).step_by(100) {
            window.push(now, RawEvent::new(Modified, "busy.md"));
        }
        // 上限の直前に届いた、atomic replaceの起点。
        window.push(599, RawEvent::new(Removed, "a.md"));

        let due = take_events(&mut window, MAX_WINDOW_MS).expect("上限で閉じない");
        // 猶予を過ぎた `old.md` は確定させ、猶予中の `a.md` は持ち越す。
        assert_eq!(
            coalesce(&due, is_markdown),
            vec![
                removed_change("old.md"),
                modified_change("busy.md"),
                directory_change("")
            ]
        );

        window.push(601, RawEvent::new(RenamedFrom, "a.md.tmp"));
        window.push(602, RawEvent::new(RenamedTo, "a.md"));

        let due = take_events(&mut window, 602 + DEBOUNCE_MS).expect("持ち越した窓が閉じない");
        assert_eq!(
            coalesce(&due, is_markdown),
            vec![modified_change("a.md"), directory_change("")]
        );
    }

    /// 対の届かないrenameの待ちを、無関係なパスの更新で延ばさない。
    ///
    /// 静穏の起点に載せると、更新が続く限り窓が閉じず、削除も他ファイルの変更も通知
    /// できないままイベントが溜まり続ける。
    #[test]
    fn an_unpaired_rename_does_not_hold_the_window_open() {
        let mut window = DebounceWindow::new();
        // 監視範囲外への移動。対の `RenamedTo` は届かない。
        window.push(0, RawEvent::new(RenamedFrom, "moved-out.md"));
        let mut now = 100;
        while now < MAX_WINDOW_MS {
            window.push(now, RawEvent::new(Modified, "busy.md"));
            now += 100;
        }
        window.push(MAX_WINDOW_MS, RawEvent::new(Modified, "busy.md"));

        assert_eq!(window.deadline_ms(), Some(MAX_WINDOW_MS));
        let events =
            take_events(&mut window, MAX_WINDOW_MS).expect("対の届かないrenameで窓が閉じない");
        // 旧パスからは失われているため、削除として確定する。
        assert_eq!(
            coalesce(&events, is_markdown),
            vec![
                removed_change("moved-out.md"),
                modified_change("busy.md"),
                directory_change("")
            ]
        );
    }

    /// 保留があっても期限は延ばさない。通知の期限と削除の確定は別である。
    #[test]
    fn a_pending_does_not_extend_the_deadline() {
        let mut window = DebounceWindow::new();
        window.push(0, RawEvent::new(Modified, "busy.md"));
        window.push(599, RawEvent::new(Removed, "a.md"));

        assert_eq!(window.deadline_ms(), Some(MAX_WINDOW_MS));
    }

    /// 同じパスの古い変更まで持ち越しても、次の期限は必ず前へ進む。
    ///
    /// 持ち越したイベントのうち最も古いものを起点にすると、この列では起点が0のまま残り、
    /// 期限が上限（600）から動かない。`take_due` が同じ時刻で空の結果を返し続け、
    /// 呼び出し側のタイマーが即時再実行を繰り返す。
    #[test]
    fn carrying_an_older_event_of_the_same_path_still_advances_the_deadline() {
        let mut window = DebounceWindow::new();
        window.push(0, RawEvent::new(Modified, "a.md"));
        window.push(599, RawEvent::new(Removed, "a.md"));

        // 両方とも `a.md` なので、確定させるものはなく持ち越しだけが残る。
        let due = take_events(&mut window, MAX_WINDOW_MS).expect("上限で閉じない");
        assert_eq!(due, Vec::new());

        // 起点は保留（599）へ寄せる。期限は必ず `now` より後になる。
        let deadline = window.deadline_ms().expect("窓が空になっている");
        assert_eq!(deadline, 599 + DEBOUNCE_MS);
        assert!(deadline > MAX_WINDOW_MS, "期限が前へ進んでいない");
        assert!(
            take_events(&mut window, MAX_WINDOW_MS).is_none(),
            "同じ時刻で繰り返し閉じている"
        );

        // 猶予が切れれば、変更と削除をまとめて削除として確定する。
        let due = take_events(&mut window, deadline).expect("猶予が切れても閉じない");
        assert_eq!(
            coalesce(&due, is_markdown),
            vec![removed_change("a.md"), directory_change("")]
        );
        assert_eq!(window.deadline_ms(), None, "窓が空にならない");
    }

    /// 持ち越しが起きるどの列でも、次の期限が `now` より後であることを固定する。
    #[test]
    fn the_deadline_always_moves_forward_after_carrying() {
        let cases: [(&str, Vec<(u64, RawEvent)>); 4] = [
            (
                "同じパスの変更と削除",
                vec![
                    (0, RawEvent::new(Modified, "a.md")),
                    (599, RawEvent::new(Removed, "a.md")),
                ],
            ),
            (
                "無関係な更新と削除",
                vec![
                    (0, RawEvent::new(Modified, "busy.md")),
                    (599, RawEvent::new(Removed, "a.md")),
                ],
            ),
            (
                "対の届かないrenameと同じパスの変更",
                vec![
                    (0, RawEvent::new(Modified, "a.md")),
                    (599, RawEvent::new(RenamedFrom, "a.md")),
                ],
            ),
            (
                "複数の保留",
                vec![
                    (0, RawEvent::new(Modified, "a.md")),
                    (598, RawEvent::new(Removed, "a.md")),
                    (599, RawEvent::new(Removed, "b.md")),
                ],
            ),
        ];

        for (name, events) in cases {
            let mut window = DebounceWindow::new();
            for (at, event) in events {
                window.push(at, event);
            }
            take_events(&mut window, MAX_WINDOW_MS).expect("上限で閉じない");
            let deadline = window.deadline_ms().expect("持ち越しが消えている");
            assert!(deadline > MAX_WINDOW_MS, "{name}: 期限が前へ進んでいない");
        }
    }

    /// 持ち越しは保留ごとの猶予で切れる。対の届かないrenameでも持ち越し続けない。
    #[test]
    fn a_carried_pending_is_confirmed_once_its_grace_passes() {
        let mut window = DebounceWindow::new();
        for now in (0..=500).step_by(100) {
            window.push(now, RawEvent::new(Modified, "busy.md"));
        }
        window.push(599, RawEvent::new(Removed, "gone.md"));

        // 上限で閉じた時点では猶予の内側なので持ち越す。
        let due = take_events(&mut window, MAX_WINDOW_MS).expect("上限で閉じない");
        assert_eq!(
            coalesce(&due, is_markdown),
            vec![modified_change("busy.md")]
        );

        // 置換が続かなければ、次の窓で削除として確定する。持ち越した時刻から測り直す。
        assert_eq!(window.deadline_ms(), Some(599 + DEBOUNCE_MS));
        let due = take_events(&mut window, 599 + DEBOUNCE_MS).expect("持ち越した削除が確定しない");
        assert_eq!(
            coalesce(&due, is_markdown),
            vec![removed_change("gone.md"), directory_change("")]
        );
        assert_eq!(window.deadline_ms(), None, "窓が空にならない");
    }

    /// 保留の解消と発生が重なり続けても、通知は上限で止まらない。
    #[test]
    fn the_window_closes_at_the_upper_bound_even_with_pendings() {
        let mut window = DebounceWindow::new();
        window.push(0, RawEvent::new(Modified, "busy.md"));
        window.push(599, RawEvent::new(Removed, "a.md"));
        // `a.md` の保留が解け、同時に `b.md` の保留が生じる。
        window.push(599, RawEvent::new(RenamedTo, "a.md"));
        window.push(599, RawEvent::new(Removed, "b.md"));

        assert_eq!(window.deadline_ms(), Some(MAX_WINDOW_MS));
        let due = take_events(&mut window, MAX_WINDOW_MS).expect("上限で閉じない");
        // `b.md` は猶予中のため確定させない。`a.md` の置換は同じ窓で解けている。
        assert_eq!(
            coalesce(&due, is_markdown),
            vec![
                modified_change("busy.md"),
                modified_change("a.md"),
                directory_change("")
            ]
        );
    }

    /// ツリー向けの通知は `is_tracked` で絞らない。
    ///
    /// `notify` のWindowsバックエンドはディレクトリとファイルを区別せず、`Removed` の
    /// パスはすでに実在しないため判別もできない。絞ると、フォルダーの作成と削除が
    /// ツリーへ反映されない（design-decisions.md 6.4）。
    #[test]
    fn coalesce_reports_changed_directories_without_filtering() {
        let cases: [(&str, Vec<RawEvent>, Vec<FileChange>); 6] = [
            (
                "対象外のファイルの作成でも親を出す",
                vec![RawEvent::new(Created, "a.md.tmp")],
                vec![directory_change("")],
            ),
            (
                // 拡張子を持たない名前はフォルダーのことが多いが、`Removed` では
                // 判別できない。判別できない側へ倒さず、常に親を出す。
                "拡張子のない名前の削除でも親を出す",
                vec![RawEvent::new(Removed, "sub")],
                vec![directory_change("")],
            ),
            (
                "入れ子のパスは自分の親を出す",
                vec![RawEvent::new(Created, "sub/deep/a.md")],
                vec![
                    modified_change("sub/deep/a.md"),
                    directory_change("sub/deep"),
                ],
            ),
            (
                "同じ親を指すイベントは1件にまとまる",
                vec![
                    RawEvent::new(Created, "a.md.tmp"),
                    RawEvent::new(Modified, "a.md.tmp"),
                    RawEvent::new(Removed, "a.md"),
                    RawEvent::new(RenamedFrom, "a.md.tmp"),
                    RawEvent::new(RenamedTo, "a.md"),
                ],
                vec![modified_change("a.md"), directory_change("")],
            ),
            (
                "異なる親はそれぞれ出す",
                vec![
                    RawEvent::new(Created, "a.md"),
                    RawEvent::new(Created, "sub/b.md"),
                ],
                vec![
                    modified_change("a.md"),
                    modified_change("sub/b.md"),
                    directory_change(""),
                    directory_change("sub"),
                ],
            ),
            (
                // ルート直下で書込みが続くと、親ディレクトリのタイムスタンプ更新が
                // `Modify(Any)` として大量に届く（実測）。子要素は増減していない。
                "内容の変更だけでは親を出さない",
                vec![
                    RawEvent::new(Modified, "a.md"),
                    RawEvent::new(Modified, "sub"),
                ],
                vec![modified_change("a.md")],
            ),
        ];

        for (name, events, expected) in cases {
            assert_eq!(coalesce(&events, is_markdown), expected, "{name}");
        }
    }

    /// 上限を超えた窓は縮退し、個別の変更を確定させない。
    #[test]
    fn a_window_over_the_event_limit_degrades() {
        let mut window = DebounceWindow::new();
        for index in 0..=MAX_EVENTS_PER_WINDOW {
            window.push(0, RawEvent::new(Created, &format!("f{index}.md")));
        }

        assert_eq!(window.deadline_ms(), Some(DEBOUNCE_MS), "窓が閉じられない");
        assert_eq!(
            window.take_due(DEBOUNCE_MS),
            Some(WindowOutcome::Overflowed)
        );
        assert_eq!(window.deadline_ms(), None, "縮退した窓が残っている");
    }

    /// 上限ちょうどでは縮退しない。
    #[test]
    fn a_window_at_the_event_limit_still_confirms_changes() {
        let mut window = DebounceWindow::new();
        for index in 0..MAX_EVENTS_PER_WINDOW {
            window.push(0, RawEvent::new(Created, &format!("f{index}.md")));
        }

        let events = take_events(&mut window, DEBOUNCE_MS).expect("上限ちょうどで閉じない");
        assert_eq!(events.len(), MAX_EVENTS_PER_WINDOW);
    }

    /// 縮退した窓は保留を持ち越さない。
    ///
    /// 縮退の結果は展開済みディレクトリの再取得とアクティブ文書の再読込であり、次の窓へ
    /// 保留を引き継いでも確定させる相手がいない。引き継ぐと、上限を超えた直後に届いた
    /// 削除が、無関係な次の窓で `FileRemoved` として確定してしまう。
    #[test]
    fn a_degraded_window_carries_nothing() {
        let mut window = DebounceWindow::new();
        window.push(0, RawEvent::new(Removed, "a.md"));
        for index in 0..=MAX_EVENTS_PER_WINDOW {
            window.push(0, RawEvent::new(Created, &format!("f{index}.md")));
        }

        assert_eq!(
            window.take_due(DEBOUNCE_MS),
            Some(WindowOutcome::Overflowed)
        );
        assert_eq!(window.deadline_ms(), None, "保留を持ち越している");
    }

    /// 縮退した窓は、上限に達したあとのイベントも溜めない。
    #[test]
    fn a_degraded_window_stops_accumulating() {
        let mut window = DebounceWindow::new();
        for index in 0..=MAX_EVENTS_PER_WINDOW {
            window.push(0, RawEvent::new(Created, &format!("f{index}.md")));
        }
        // 縮退後も窓は開いており、上限で閉じるまで期限は進む。
        window.push(300, RawEvent::new(Created, "late.md"));

        assert_eq!(window.deadline_ms(), Some(300 + DEBOUNCE_MS));
        assert_eq!(
            window.take_due(300 + DEBOUNCE_MS),
            Some(WindowOutcome::Overflowed)
        );
    }
}
