//! ファイル監視の時間に関する定数と、debounce窓の畳み込み規則。
//!
//! ライフサイクルは design-decisions.md 6.4、6.5 を正本とする。`notify` のイベントを
//! ここの生イベントへ写像する処理と、窓を閉じる時間管理はPhase 4で行う。

use crate::ipc::types::FileChange;

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
/// | `Removed P` があり、同じ窓で `P` が作り直されない | `FileRemoved P` |
/// | `Created P` または `Modified P` だけ | `FileModified P` |
///
/// 対象外のパスに対する変更は返さない。ツリーの更新に必要な `DirectoryChanged` は、
/// ここで確定した作成・削除・renameの親ディレクトリに対してPhase 4で別途生成する。
pub fn coalesce(events: &[RawEvent], is_tracked: impl Fn(&str) -> bool) -> Vec<FileChange> {
    let mut changes: Vec<FileChange> = Vec::new();
    // 削除は、同じ窓の中で置換やrename先として復活しうるため、窓を閉じるまで確定させない。
    let mut removed: Vec<String> = Vec::new();
    let mut modified: Vec<String> = Vec::new();
    let mut rename_source: Option<String> = None;

    for event in events {
        match event.kind {
            RawEventKind::RenamedFrom => rename_source = Some(event.path.clone()),
            RawEventKind::RenamedTo => {
                let source = rename_source.take().filter(|s| is_tracked(s));
                if !is_tracked(&event.path) {
                    // 対象のファイルが対象外の名前へ移された場合は、消えたものとして扱う。
                    if let Some(source) = source {
                        push_once(&mut removed, &source);
                    }
                    continue;
                }
                let replaced = remove_first(&mut removed, &event.path);
                match source {
                    Some(source) if !replaced => changes.push(FileChange::FileRenamed {
                        path: event.path.clone(),
                        old_path: source,
                    }),
                    // 対象のファイルを既存のファイルへ上書きrenameした場合。
                    // 移動元は失われるため、置換と削除の両方を通知する。
                    Some(source) => {
                        changes.push(FileChange::FileRemoved { path: source });
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

    /// ツリーの対象は `.md` と `.markdown` に限る（design-decisions.md 6.3）。
    fn is_markdown(path: &str) -> bool {
        path.ends_with(".md") || path.ends_with(".markdown")
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
}
