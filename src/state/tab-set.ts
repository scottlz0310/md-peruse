import type { DocumentTab } from "./document-tab";
import { MAX_OPEN_TABS, selectEvictableTab } from "./tabs";

/**
 * 開いているタブの集合（design-decisions.md 9.1）。
 *
 * ツリーから開いた文書は、まず「プレビュータブ」として開く。プレビュータブは常に最大1枚で、
 * 次のプレビューはそのタブを差し替える。ダブルクリック、`Enter`、タブのダブルクリック、
 * タブ内での移動（本文のリンク、見出し）で固定タブになる。VS CodeのExplorerとeditor groupの
 * 操作に揃え、ツリーを眺めるだけでタブが増えて上限の退避が起きないようにするためである。
 *
 * 同じ文書は重複して開かず、既に開いているタブへ切り替える。
 */

export type OpenTab = DocumentTab & {
  /** 次のプレビューで差し替えられるタブか。 */
  readonly preview: boolean;
  /** 最後にアクティブになった時刻（ミリ秒）。上限を超えたときの退避に使う（9.1）。 */
  readonly lastActivatedAt: number;
};

export type TabSet = {
  /** タブバーの並び順。 */
  readonly tabs: readonly OpenTab[];
  readonly activeTabId: string | null;
};

export const EMPTY_TAB_SET: TabSet = { tabs: [], activeTabId: null };

export function activeTab(set: TabSet): OpenTab | undefined {
  return set.tabs.find((tab) => tab.tabId === set.activeTabId);
}

export type OpenRequest = {
  readonly path: string;
  /** プレビューとして開くか。`false` なら固定タブとして開く。 */
  readonly preview: boolean;
  readonly now: number;
  /** 新しいタブを作るときに使うIDとスコープ。 */
  readonly fresh: { readonly tabId: string; readonly scopeId: string };
};

/**
 * 文書をタブで開く。
 *
 * - 同じ文書のタブがあれば、それをアクティブにする。固定で開いたときはそのタブを固定する
 * - プレビューで開き、プレビュータブがあれば、それを新しいタブで置き換える（同じ位置）
 * - それ以外は、アクティブタブの右に新しいタブを加える。上限を超えたら退避する
 *
 * `opened` は新しく作ったタブであり、呼び出し側が読込を始める。既存のタブへ切り替えた
 * ときは `undefined` を返す。差し替えたプレビュータブはIDを替えるため、読込中だった
 * 応答は照合で捨てられる（6.5）。
 */
export function openTab(
  set: TabSet,
  request: OpenRequest,
): { set: TabSet; opened: OpenTab | undefined } {
  const existing = set.tabs.find((tab) => tab.path === request.path);
  if (existing) {
    const pinned = request.preview ? set : pinTab(set, existing.tabId);
    return {
      set: activateTab(pinned, existing.tabId, request.now),
      opened: undefined,
    };
  }
  const fresh: OpenTab = {
    ...request.fresh,
    path: request.path,
    status: "loaded",
    loadGeneration: 0,
    history: { entries: [], index: 0 },
    preview: request.preview,
    lastActivatedAt: request.now,
  };
  const previewIndex = request.preview
    ? set.tabs.findIndex((tab) => tab.preview)
    : -1;
  if (previewIndex >= 0) {
    const tabs = [...set.tabs];
    tabs[previewIndex] = fresh;
    return { set: { tabs, activeTabId: fresh.tabId }, opened: fresh };
  }
  const activeIndex = set.tabs.findIndex(
    (tab) => tab.tabId === set.activeTabId,
  );
  const tabs = [...set.tabs];
  tabs.splice(activeIndex + 1, 0, fresh);
  let next: TabSet = { tabs, activeTabId: fresh.tabId };
  if (next.tabs.length > MAX_OPEN_TABS) {
    const evicted = selectEvictableTab(next.tabs, fresh.tabId);
    if (evicted) next = removeTab(next, evicted.tabId);
  }
  return { set: next, opened: fresh };
}

/** タブをアクティブにする。存在しないIDなら何もしない。 */
export function activateTab(set: TabSet, tabId: string, now: number): TabSet {
  if (!set.tabs.some((tab) => tab.tabId === tabId)) return set;
  return {
    tabs: set.tabs.map((tab) =>
      tab.tabId === tabId ? { ...tab, lastActivatedAt: now } : tab,
    ),
    activeTabId: tabId,
  };
}

/** プレビュータブを固定する。 */
export function pinTab(set: TabSet, tabId: string): TabSet {
  const target = set.tabs.find((tab) => tab.tabId === tabId);
  if (!target?.preview) return set;
  return {
    ...set,
    tabs: set.tabs.map((tab) =>
      tab.tabId === tabId ? { ...tab, preview: false } : tab,
    ),
  };
}

/** タブの状態を差し替える。閉じられたタブなら何もしない。 */
export function updateTab(
  set: TabSet,
  tabId: string,
  update: (tab: OpenTab) => OpenTab,
): TabSet {
  return {
    ...set,
    tabs: set.tabs.map((tab) => (tab.tabId === tabId ? update(tab) : tab)),
  };
}

/**
 * タブを閉じる。アクティブタブを閉じたときは、右隣、なければ左隣をアクティブにする。
 *
 * 隣を選ぶのは、閉じた位置の近くで作業を続けられるようにするためである。
 */
export function closeTab(set: TabSet, tabId: string, now: number): TabSet {
  const index = set.tabs.findIndex((tab) => tab.tabId === tabId);
  if (index < 0) return set;
  const removed = removeTab(set, tabId);
  if (set.activeTabId !== tabId) return removed;
  const neighbor = removed.tabs[index] ?? removed.tabs[index - 1];
  return neighbor
    ? activateTab(removed, neighbor.tabId, now)
    : { tabs: removed.tabs, activeTabId: null };
}

/** 並び順で次・前のタブのID。端では反対側へ回る。タブがなければ `undefined`。 */
export function adjacentTabId(
  set: TabSet,
  direction: "next" | "previous",
): string | undefined {
  if (set.tabs.length === 0) return undefined;
  const index = set.tabs.findIndex((tab) => tab.tabId === set.activeTabId);
  const step = direction === "next" ? 1 : -1;
  const count = set.tabs.length;
  return set.tabs[(index + step + count) % count]?.tabId;
}

function removeTab(set: TabSet, tabId: string): TabSet {
  return { ...set, tabs: set.tabs.filter((tab) => tab.tabId !== tabId) };
}

/** タブに表示する名前。パスの最後の要素。 */
export function tabTitle(tab: OpenTab): string {
  return tab.path.slice(tab.path.lastIndexOf("/") + 1);
}
