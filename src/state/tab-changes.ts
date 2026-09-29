import type { FileChangeEvent } from "../types/generated/FileChangeEvent";
import { renameHistoryPath } from "./doc-history";
import type { OpenTab, TabSet } from "./tab-set";
import { applyFileChange } from "./tab-status";

/** ファイル変更を全タブへ適用した結果。 */
export type TabChanges = {
  readonly set: TabSet;
  /**
   * 再読込を始めるタブ。アクティブタブが変更を受けて `stale` になったときだけ入る。
   * 非アクティブタブは本文を持たず、アクティブになったときに読み直す（9.1）。
   */
  readonly reloadTabId: string | null;
};

/**
 * ファイル変更のイベントを、開いているすべてのタブへ適用する（design-decisions.md 6.4、6.5）。
 *
 * 個々のタブの遷移は `applyFileChange` が決める。ここが足すのは次の2つ。
 *
 * - renameを受けたタブの履歴を、新しいパスへ追従させる。タブのパスだけを移すと、戻ったときに
 *   旧パスの読込が失敗し、renameを追跡した意味がなくなる（9.3）。現在のパスが違うタブでも、
 *   履歴に旧パスの項目があれば差し替える。
 * - どのタブを再読込するかを返す。読込世代が進んだ `stale` のアクティブタブだけである。
 *   世代が進んでいなければ、変更はそのタブに関係しない。すでに `stale` だったタブが新しい
 *   変更を受けたときは世代が進むため、再読込をやり直す。
 */
export function applyChangeToTabs(
  set: TabSet,
  event: FileChangeEvent,
): TabChanges {
  const change = event.change;
  let reloadTabId: string | null = null;
  let touched = false;
  const tabs = set.tabs.map((tab) => {
    let next: OpenTab = applyFileChange(tab, event);
    if (
      change.kind === "fileRenamed" &&
      event.scopeId === tab.scopeId &&
      tab.status !== "deleted"
    ) {
      const history = renameHistoryPath(
        tab.history,
        change.oldPath,
        change.path,
      );
      if (history !== next.history) next = { ...next, history };
    }
    if (next === tab) return tab;
    touched = true;
    if (
      tab.tabId === set.activeTabId &&
      next.status === "stale" &&
      next.loadGeneration !== tab.loadGeneration
    ) {
      reloadTabId = tab.tabId;
    }
    return next;
  });
  return touched
    ? { set: { ...set, tabs }, reloadTabId }
    : { set, reloadTabId };
}
