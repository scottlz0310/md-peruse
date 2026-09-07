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
/// 値は暫定であり、Phase 4で実測して確定する。長くすると再描画が遅れ、短くすると
/// atomic replaceの `Remove` を削除と誤判定する確率が上がる。
pub const DEBOUNCE_MS: u64 = 150;

/// 置換直後の読込失敗に対して許す再読込の回数（design-decisions.md 6.5）。
///
/// 「共有違反時に自動リトライしない」という原則の限定的な例外であり、同一イベントに
/// 対して1回だけ許す。回数を増やすと、実際に他プロセスがロックし続けている状況で
/// 失敗の提示が遅れる。
pub const REPLACE_RETRY_LIMIT: u32 = 1;

/// 再読込までの待ち時間（ミリ秒）。
///
/// 値は暫定であり、Phase 4で `DEBOUNCE_MS` と併せて実測して確定する。
pub const REPLACE_RETRY_DELAY_MS: u64 = 100;

// 再読込の待ちはdebounceの窓に収まらなければならない。窓より長いと、次のdebounceが
// 確定した後に前の再読込を開始することになる。両方の値をPhase 4で実測して差し替える
// ため、関係をコンパイル時に固定する。
const _: () = assert!(REPLACE_RETRY_DELAY_MS < DEBOUNCE_MS);

/// 1つの窓を開いていられる最長時間（ミリ秒）。
///
/// 窓は最後のイベントから `DEBOUNCE_MS` の静穏で閉じる。最初のイベントからの固定窓に
/// しないのは、atomic replaceの列（`Remove` のあとに `Modify(Name(To))` が続く）が窓を
/// またぐと、先の窓が `FileRemoved` を確定させてタブを終端状態の `deleted` にしてしまう
/// ためである（design-decisions.md 6.5）。
///
/// 一方で静穏だけを条件にすると、書込みが続く間は窓が閉じず表示が更新されない。この上限で
/// 強制的に閉じる。ただし保留（作り直されていない `Removed`、対の届いていない
/// `RenamedFrom`）がある間は、その保留が届いてから `DEBOUNCE_MS` まで待つ。置換の途中で
/// 窓を切ると、上と同じ誤判定が起きるためである。待ちの合計は
/// `MAX_WINDOW_MS + DEBOUNCE_MS` で必ず打ち切る。規則の詳細は `DebounceWindow::deadline_ms`
/// を正本とする。
pub const MAX_WINDOW_MS: u64 = 600;

// 上限は静穏の窓より長くなければならない。短いと静穏による確定へ到達しない。
const _: () = assert!(MAX_WINDOW_MS > DEBOUNCE_MS);

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
}

impl DebounceWindow {
    pub fn new() -> Self {
        Self::default()
    }

    /// 窓へイベントを入れる。空の窓なら、このイベントで窓が開く。
    pub fn push(&mut self, now_ms: u64, event: RawEvent) {
        if self.events.is_empty() {
            self.opened_at_ms = now_ms;
        }
        self.last_event_ms = now_ms;
        self.events.push((now_ms, event));
    }

    /// 窓を閉じる時刻。開いていなければ `None` を返す。
    ///
    /// 基本は最後のイベントからの静穏（`DEBOUNCE_MS`）で閉じる。書込みが続く間に窓が
    /// 閉じず表示が更新されないことを避けるため、開いてから `MAX_WINDOW_MS` でも閉じる。
    ///
    /// ただし「保留」がある間は上限で閉じない。保留とは、この時点で窓を閉じると
    /// `FileRemoved` を確定させてしまう状態であり、次の2つを指す。
    ///
    /// - 同じ窓で作り直されていない `Removed`。atomic replaceは `Removed` から始まるため、
    ///   これを上限で切ると、続く `RenamedTo` が次の窓へ回り、タブが終端状態の `deleted`
    ///   から戻らなくなる（design-decisions.md 6.5）。
    /// - 対の `RenamedTo` が届いていない `RenamedFrom`。
    ///
    /// 保留の猶予は「最も古い保留が届いた時刻」から `DEBOUNCE_MS` とする。静穏の起点
    /// （`last_event_ms`）に載せると、無関係なパスの更新が続く間ずっと窓が延び、通知が
    /// 止まったままイベントが溜まり続ける。最も古い保留を起点にするのは、保留が次々に
    /// 現れても猶予の起点が前へ動かないようにするためである。
    ///
    /// いずれにせよ窓は `MAX_WINDOW_MS + DEBOUNCE_MS` で閉じる。保留の解消と発生が
    /// 重なり続ける列でも窓が閉じないことを避けるための絶対の上限であり、ここで切る
    /// ときだけは置換を分断しうる。
    pub fn deadline_ms(&self) -> Option<u64> {
        if self.events.is_empty() {
            return None;
        }
        let quiet = self.last_event_ms + DEBOUNCE_MS;
        let mut deadline = quiet.min(self.opened_at_ms + MAX_WINDOW_MS);
        if let Some(pending_at) = self.oldest_pending_ms() {
            deadline = deadline
                .max(pending_at + DEBOUNCE_MS)
                .min(self.opened_at_ms + MAX_WINDOW_MS + DEBOUNCE_MS);
        }
        Some(deadline)
    }

    /// 窓が閉じていれば、溜まったイベントを取り出す。閉じていなければ `None` を返す。
    pub fn take_due(&mut self, now_ms: u64) -> Option<Vec<RawEvent>> {
        if now_ms < self.deadline_ms()? {
            return None;
        }
        Some(
            std::mem::take(&mut self.events)
                .into_iter()
                .map(|(_, event)| event)
                .collect(),
        )
    }

    /// 最も古い保留が届いた時刻。保留がなければ `None` を返す。
    ///
    /// 復活の規則は `coalesce` と揃える。`coalesce` が削除を取り消す事象（同じパスの
    /// `Created`、`Modified`、`RenamedTo`）でここでも保留を外す。ここだけ緩いと、
    /// `coalesce` が `FileRemoved` を返す状態のまま上限で窓を切ることになる。
    ///
    /// `is_tracked` は見ない。対象外のパスの削除を保留として数えても、上限を超えて待つ
    /// 時間が `DEBOUNCE_MS` 延びるだけであり、置換を分断する側の誤りは起きない。
    fn oldest_pending_ms(&self) -> Option<u64> {
        let mut removed: Vec<(&str, u64)> = Vec::new();
        let mut renamed_from: Vec<u64> = Vec::new();
        for (at, event) in &self.events {
            match event.kind {
                RawEventKind::Removed => removed.push((&event.path, *at)),
                RawEventKind::Created | RawEventKind::Modified => {
                    remove_first_removal(&mut removed, &event.path);
                }
                RawEventKind::RenamedFrom => renamed_from.push(*at),
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
            .map(|(_, at)| at)
            .chain(renamed_from)
            .min()
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
/// 対象外のパスに対する変更は返さない。ツリーの更新に必要な `DirectoryChanged` は、
/// ここで確定した作成・削除・renameの親ディレクトリに対してPhase 4で別途生成する。
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
    changes
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
                "対象外のファイルだけの変更は無視する",
                vec![
                    RawEvent::new(Created, "a.md.tmp"),
                    RawEvent::new(Modified, "a.md.tmp"),
                ],
                vec![],
            ),
        ];

        for (name, events, expected) in cases {
            assert_eq!(coalesce(&events, is_markdown), expected, "{name}");
        }
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
            assert_eq!(coalesce(&events, is_markdown), expected, "{name}");
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
            assert_eq!(coalesce(&events, is_markdown), expected, "{name}");
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
        assert_eq!(window.take_due(u64::MAX), None);
    }

    #[test]
    fn the_window_closes_after_a_quiet_period() {
        let mut window = DebounceWindow::new();
        window.push(1_000, RawEvent::new(Modified, "a.md"));

        assert_eq!(window.deadline_ms(), Some(1_000 + DEBOUNCE_MS));
        assert_eq!(window.take_due(1_000 + DEBOUNCE_MS - 1), None);

        let events = window
            .take_due(1_000 + DEBOUNCE_MS)
            .expect("静穏で窓が閉じない");
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

        assert!(window.take_due(100 + DEBOUNCE_MS - 1).is_none());
        assert_eq!(
            window
                .take_due(100 + DEBOUNCE_MS)
                .map(|events| events.len()),
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
                window.take_due(now).is_none(),
                "上限より前に閉じている: {now}"
            );
            now += DEBOUNCE_MS - 50;
        }
        window.push(MAX_WINDOW_MS, RawEvent::new(Modified, "a.md"));

        assert_eq!(window.deadline_ms(), Some(MAX_WINDOW_MS));
        assert!(window.take_due(MAX_WINDOW_MS).is_some(), "上限で閉じない");
    }

    /// 上限の直前に届いた `Removed` を、atomic replaceの起点として保留する。
    ///
    /// 保留しないと、上限で窓を切った時点で `FileRemoved` が確定し、次の窓へ回った
    /// `RenamedTo` の `FileModified` では終端状態の `deleted` から戻れない（6.5）。
    #[test]
    fn a_removal_near_the_upper_bound_waits_for_the_replacement() {
        let mut window = DebounceWindow::new();
        // 無関係なファイルの書込みが続き、窓が上限に達しようとしている。
        for now in (0..=500).step_by(100) {
            window.push(now, RawEvent::new(Modified, "busy.md"));
        }
        window.push(599, RawEvent::new(Removed, "a.md"));

        assert!(
            window.take_due(MAX_WINDOW_MS).is_none(),
            "置換の起点となる削除を上限で切っている"
        );

        window.push(601, RawEvent::new(RenamedFrom, "a.md.tmp"));
        window.push(602, RawEvent::new(RenamedTo, "a.md"));

        let events = window.take_due(602).expect("保留が解けても閉じない");
        // 同じ窓に収まっているため、削除ではなく置換として確定する。
        assert_eq!(
            coalesce(&events, is_markdown),
            vec![modified_change("busy.md"), modified_change("a.md")]
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
        let events = window
            .take_due(MAX_WINDOW_MS)
            .expect("対の届かないrenameで窓が閉じない");
        // 旧パスからは失われているため、削除として確定する。
        assert_eq!(
            coalesce(&events, is_markdown),
            vec![removed_change("moved-out.md"), modified_change("busy.md")]
        );
    }

    #[test]
    fn a_pending_extends_the_upper_bound_only_by_the_quiet_period() {
        let mut window = DebounceWindow::new();
        window.push(0, RawEvent::new(Modified, "busy.md"));
        window.push(599, RawEvent::new(RenamedFrom, "a.md.tmp"));

        // 上限（600）ではなく、保留が届いた時刻からの猶予で決まる。
        assert_eq!(window.deadline_ms(), Some(599 + DEBOUNCE_MS));

        // 対が揃えば保留が消え、上限が効く。
        window.push(600, RawEvent::new(RenamedTo, "a.md"));
        assert_eq!(window.deadline_ms(), Some(MAX_WINDOW_MS));
    }

    #[test]
    fn the_window_always_closes_at_the_absolute_bound() {
        // 保留の解消と発生が重なると、猶予の起点（最も古い保留）が前へ進む。
        // 絶対の上限がないと、この繰り返しで窓が閉じなくなる。
        let mut window = DebounceWindow::new();
        window.push(0, RawEvent::new(Modified, "busy.md"));

        window.push(599, RawEvent::new(Removed, "a.md"));
        assert_eq!(window.deadline_ms(), Some(599 + DEBOUNCE_MS));

        // `a.md` の保留が解け、同時に `b.md` の保留が生じる。起点は700へ進む。
        window.push(700, RawEvent::new(RenamedTo, "a.md"));
        window.push(700, RawEvent::new(Removed, "b.md"));

        let absolute = MAX_WINDOW_MS + DEBOUNCE_MS;
        assert!(700 + DEBOUNCE_MS > absolute, "テストの前提を満たしていない");
        assert_eq!(window.deadline_ms(), Some(absolute));
        assert!(window.take_due(absolute).is_some(), "絶対の上限で閉じない");
    }
}
