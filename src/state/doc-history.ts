/**
 * タブごとの戻る／進む履歴（design-decisions.md 7.2、9.1）。
 *
 * WebView2のHistory APIには載せない。`history` はWebView単位に1本しかなく、タブごとに
 * 分けられないためである。WebView側の履歴を空のまま保てば、`Alt+←` とマウスのサイド
 * ボタンはWebViewの履歴を動かさず、`keydown` と `auxclick` としてだけ届く（実測）。
 * その2つの入力を自前のスタックへつなぐ。
 */

/**
 * 1タブが保持する履歴の上限。
 *
 * 超過するときは最も古い項目を捨てる。文書とアンカーの両方を積むため（下記
 * {@link pushHistoryEntry}）、目次の多い文書を行き来すると項目が伸びやすい。50件を
 * 超えて遡る操作はツリーから開き直すほうが速く、上限を大きくしても得るものがない。
 */
export const MAX_HISTORY_ENTRIES = 50;

/** 履歴の1項目。タブの中で「どこを見ていたか」を表す。 */
export type HistoryEntry = {
  /** スコープ（ワークスペース、またはloose tabの暗黙のルート）のルートからの相対パス。 */
  readonly path: string;
  /**
   * 見出しのID。`user-content-` を前置した形で持つ（design-decisions.md 7.2）。
   *
   * 文書の先頭を指す場合は `null`。アンカーなしのリンク遷移と、アンカーへの移動を
   * 区別するために必要である。
   */
  readonly anchor: string | null;
  /** その位置を離れた時点のスクロール位置（px）。 */
  readonly scrollTop: number;
};

/** タブの履歴。`index` は `entries` の中の現在位置を指す。 */
export type TabHistory = {
  readonly entries: readonly HistoryEntry[];
  readonly index: number;
};

/** 最初の項目だけを持つ履歴を作る。タブを開いた時点で1件から始まる。 */
export function createHistory(entry: HistoryEntry): TabHistory {
  return { entries: [entry], index: 0 };
}

/** 現在位置の項目を返す。履歴が空のときは `undefined`。 */
export function currentEntry(history: TabHistory): HistoryEntry | undefined {
  return history.entries[history.index];
}

export function canGoBack(history: TabHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: TabHistory): boolean {
  return history.index < history.entries.length - 1;
}

/**
 * 新しい項目を積む。
 *
 * 現在位置より後ろ（進む側）の項目は捨てる。戻ったあとに別の場所へ移動したら、進む先は
 * もう存在しないためである。
 *
 * 現在位置と同じ場所（`path` と `anchor` が一致）を指す項目は積まない。同じ見出しへの
 * リンクを続けて押したときに履歴が伸びるのを防ぐ。ただしスクロール位置は受け取った値で
 * 更新する。
 *
 * 上限（{@link MAX_HISTORY_ENTRIES}）を超えるときは先頭から捨てる。
 *
 * タブ内で表示が変わった経路（本文のリンク、ツリー、パンくず）を区別せず積む。同じ
 * 「表示が変わる」操作が入口ごとに違う結果を返さないようにするためである。
 */
export function pushHistoryEntry(
  history: TabHistory,
  entry: HistoryEntry,
): TabHistory {
  const current = currentEntry(history);
  if (
    current !== undefined &&
    current.path === entry.path &&
    current.anchor === entry.anchor
  ) {
    return updateCurrentScroll(history, entry.scrollTop);
  }
  const kept = history.entries.slice(0, history.index + 1);
  const appended = [...kept, entry];
  const overflow = Math.max(appended.length - MAX_HISTORY_ENTRIES, 0);
  return {
    entries: appended.slice(overflow),
    index: appended.length - overflow - 1,
  };
}

/** 現在位置のスクロール位置を更新する。位置を離れる直前に呼ぶ。 */
export function updateCurrentScroll(
  history: TabHistory,
  scrollTop: number,
): TabHistory {
  const current = currentEntry(history);
  if (current === undefined || current.scrollTop === scrollTop) {
    return history;
  }
  const entries = [...history.entries];
  entries[history.index] = { ...current, scrollTop };
  return { entries, index: history.index };
}

/** 1つ戻る。戻れないときは受け取った履歴をそのまま返す。 */
export function goBack(history: TabHistory): TabHistory {
  return canGoBack(history)
    ? { entries: history.entries, index: history.index - 1 }
    : history;
}

/** 1つ進む。進めないときは受け取った履歴をそのまま返す。 */
export function goForward(history: TabHistory): TabHistory {
  return canGoForward(history)
    ? { entries: history.entries, index: history.index + 1 }
    : history;
}

/**
 * 指定した位置の項目を取り除く。
 *
 * 戻った先の文書が読み込めなかったときに使う。削除された文書を指す項目を残すと、戻る／
 * 進むのたびに同じ失敗を繰り返すことになる。削除を検知した時点ではなく読込に失敗した
 * 時点で取り除くのは、`deleted` の判定がRust側の監視に依存し（design-decisions.md 6.5）、
 * 履歴が独自にファイルの生存を追う必要をなくすためである。
 *
 * 現在位置より前を取り除いたときは `index` を1つ詰める。現在位置そのものを取り除いた
 * ときは、同じ `index` が次の項目を指す。末尾を取り除いた場合は1つ前へ下がる。
 * 最後の1件を取り除くと空の履歴になり、`index` は0となる。
 */
export function removeHistoryEntryAt(
  history: TabHistory,
  target: number,
): TabHistory {
  if (target < 0 || target >= history.entries.length) {
    return history;
  }
  const entries = history.entries.filter((_, i) => i !== target);
  if (entries.length === 0) {
    return { entries, index: 0 };
  }
  const shifted = target < history.index ? history.index - 1 : history.index;
  return { entries, index: Math.min(Math.max(shifted, 0), entries.length - 1) };
}

/**
 * renameを追跡してパスを差し替える（design-decisions.md 6.5）。
 *
 * タブのパスが追従する以上、そのタブの履歴も同じパスを指し続けなければならない。追従
 * させないと、戻ったときに旧パスの読込が失敗し、renameを追跡した意味がなくなる。
 *
 * 一致しない項目はそのまま残す。同じ履歴に旧パスと新パスの両方が含まれることはあり、
 * その場合は旧パスの項目だけが差し替わる。
 */
export function renameHistoryPath(
  history: TabHistory,
  from: string,
  to: string,
): TabHistory {
  if (!history.entries.some((entry) => entry.path === from)) {
    return history;
  }
  return {
    entries: history.entries.map((entry) =>
      entry.path === from ? { ...entry, path: to } : entry,
    ),
    index: history.index,
  };
}
