import { describe, expect, test } from "bun:test";
import type { FileChange } from "../types/generated/FileChange";
import type { TabHistory } from "./doc-history";
import { applyChangeToTabs } from "./tab-changes";
import {
  activateTab,
  EMPTY_TAB_SET,
  openTab,
  pendingPath,
  type TabSet,
  updateTab,
} from "./tab-set";

const SCOPE = "scope-1";

/** 固定タブで順に開き、最後に開いたタブをアクティブにした集合。 */
function opened(...paths: string[]): TabSet {
  return paths.reduce(
    (set, path, index) =>
      openTab(set, {
        path,
        preview: false,
        now: index,
        fresh: { tabId: `tab-${path}`, scopeId: SCOPE },
      }).set,
    EMPTY_TAB_SET,
  );
}

/** 最初に開いたときのパスで探す。タブのIDはrenameで変わらない。 */
const tab = (set: TabSet, openedAs: string) => {
  const found = set.tabs.find(
    (candidate) => candidate.tabId === `tab-${openedAs}`,
  );
  if (found === undefined) throw new Error(`${openedAs} のタブがない`);
  return found;
};

const event = (change: FileChange, scopeId = SCOPE) => ({ scopeId, change });
const modified = (path: string): FileChange => ({ kind: "fileModified", path });
const removed = (path: string): FileChange => ({ kind: "fileRemoved", path });
const renamed = (oldPath: string, path: string): FileChange => ({
  kind: "fileRenamed",
  oldPath,
  path,
});

const historyOf = (...paths: string[]): TabHistory => ({
  entries: paths.map((path) => ({ path, anchor: null, scrollTop: 0 })),
  index: paths.length - 1,
});

describe("変更（6.5）", () => {
  test("変更を受けたタブは stale になり、アクティブなら再読込を求める", () => {
    const set = opened("a.md", "b.md");

    const changed = applyChangeToTabs(set, event(modified("b.md")));

    expect(tab(changed.set, "b.md").status).toBe("stale");
    expect(changed.reloadTabId).toBe("tab-b.md");
    expect(tab(changed.set, "a.md").status).toBe("loaded");
  });

  test("非アクティブなタブは stale にするだけで、再読込は求めない", () => {
    const set = opened("a.md", "b.md");

    const changed = applyChangeToTabs(set, event(modified("a.md")));

    expect(tab(changed.set, "a.md").status).toBe("stale");
    expect(changed.reloadTabId).toBeNull();
  });

  test("すでに stale のアクティブタブが新しい変更を受けたら、再読込をやり直す", () => {
    const first = applyChangeToTabs(opened("a.md"), event(modified("a.md")));
    const generation = tab(first.set, "a.md").loadGeneration;

    const second = applyChangeToTabs(first.set, event(modified("a.md")));

    expect(tab(second.set, "a.md").loadGeneration).toBe(generation + 1);
    expect(second.reloadTabId).toBe("tab-a.md");
  });

  test("進行中の読込は、変更を受けると無効になる", () => {
    const set = updateTab(opened("a.md"), "tab-a.md", (current) => ({
      ...current,
      pending: { path: "b.md", generation: current.loadGeneration },
    }));
    expect(pendingPath(tab(set, "a.md"))).toBe("b.md");

    const changed = applyChangeToTabs(set, event(modified("a.md")));

    expect(pendingPath(tab(changed.set, "a.md"))).toBeNull();
  });

  test.each([
    ["別のパスの変更", event(modified("other.md"))],
    ["別のスコープの同じパスの変更", event(modified("a.md"), "scope-2")],
    ["ツリーの更新の通知", event({ kind: "directoryChanged", path: "" })],
  ])("%sは、どのタブにも影響しない", (_, ignored) => {
    const set = opened("a.md");

    const changed = applyChangeToTabs(set, ignored);

    expect(changed.set).toBe(set);
    expect(changed.reloadTabId).toBeNull();
  });
});

describe("削除（6.5）", () => {
  test("削除が確定したタブは deleted になり、アクティブでも再読込は求めない", () => {
    const changed = applyChangeToTabs(opened("a.md"), event(removed("a.md")));

    expect(tab(changed.set, "a.md").status).toBe("deleted");
    expect(changed.reloadTabId).toBeNull();
  });

  test("deleted は終端で、同じパスの変更を受けても戻らない", () => {
    const deleted = applyChangeToTabs(opened("a.md"), event(removed("a.md")));

    const later = applyChangeToTabs(deleted.set, event(modified("a.md")));

    expect(later.set).toBe(deleted.set);
    expect(later.reloadTabId).toBeNull();
  });
});

describe("rename（6.5）", () => {
  test("タブのパスと履歴の旧パスを新しいパスへ追従させ、状態は保つ", () => {
    const set = updateTab(opened("a.md"), "tab-a.md", (current) => ({
      ...current,
      history: historyOf("x.md", "a.md"),
    }));

    const changed = applyChangeToTabs(set, event(renamed("a.md", "docs/c.md")));

    const after = tab(changed.set, "a.md");
    expect(after.path).toBe("docs/c.md");
    expect(after.status).toBe("loaded");
    expect(after.history.entries.map((entry) => entry.path)).toEqual([
      "x.md",
      "docs/c.md",
    ]);
    expect(changed.reloadTabId).toBeNull();
  });

  test("現在のパスが違うタブでも、履歴に旧パスがあれば差し替える", () => {
    const set = updateTab(opened("a.md", "b.md"), "tab-b.md", (current) => ({
      ...current,
      history: historyOf("a.md", "b.md"),
    }));

    const changed = applyChangeToTabs(set, event(renamed("a.md", "c.md")));

    expect(tab(changed.set, "b.md").path).toBe("b.md");
    expect(
      tab(changed.set, "b.md").history.entries.map((entry) => entry.path),
    ).toEqual(["c.md", "b.md"]);
  });

  test("別のスコープのrenameは、履歴にも影響しない", () => {
    const set = updateTab(opened("a.md"), "tab-a.md", (current) => ({
      ...current,
      history: historyOf("a.md"),
    }));

    const changed = applyChangeToTabs(
      set,
      event(renamed("a.md", "c.md"), "scope-2"),
    );

    expect(changed.set).toBe(set);
  });

  test("stale のまま rename されたアクティブタブは、新しいパスを再読込する", () => {
    const stale = applyChangeToTabs(opened("a.md"), event(modified("a.md")));

    const changed = applyChangeToTabs(
      stale.set,
      event(renamed("a.md", "c.md")),
    );

    expect(tab(changed.set, "a.md").path).toBe("c.md");
    expect(changed.reloadTabId).toBe("tab-a.md");
  });

  test("deleted のタブは rename に追従しない", () => {
    const set = updateTab(opened("a.md"), "tab-a.md", (current) => ({
      ...current,
      status: "deleted",
      history: historyOf("a.md"),
    }));

    const changed = applyChangeToTabs(set, event(renamed("a.md", "c.md")));

    expect(changed.set).toBe(set);
  });
});

describe("アクティブタブの切り替え", () => {
  test("再読込を求めるのは、変更を受けた時点のアクティブタブだけ", () => {
    const set = activateTab(opened("a.md", "b.md"), "tab-a.md", 9);

    expect(
      applyChangeToTabs(set, event(modified("b.md"))).reloadTabId,
    ).toBeNull();
    expect(applyChangeToTabs(set, event(modified("a.md"))).reloadTabId).toBe(
      "tab-a.md",
    );
  });
});
