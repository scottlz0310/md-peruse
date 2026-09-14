import { describe, expect, test } from "bun:test";
import {
  activateTab,
  adjacentTabId,
  closeTab,
  EMPTY_TAB_SET,
  type OpenRequest,
  openTab,
  pinTab,
  type TabSet,
  tabTitle,
} from "./tab-set";
import { MAX_OPEN_TABS } from "./tabs";

let seq = 0;
const request = (path: string, preview: boolean, now = 0): OpenRequest => {
  seq += 1;
  return {
    path,
    preview,
    now,
    fresh: { tabId: `tab-${seq}`, scopeId: "scope" },
  };
};

/** 固定タブで順に開いた集合。 */
function pinned(...paths: string[]): TabSet {
  return paths.reduce(
    (set, path, index) => openTab(set, request(path, false, index)).set,
    EMPTY_TAB_SET,
  );
}

const summary = (set: TabSet) =>
  set.tabs.map((tab) => [
    tab.path,
    tab.preview ? "preview" : "pinned",
    tab.tabId === set.activeTabId ? "active" : "",
  ]);

describe("openTab", () => {
  test("プレビューで開くと、既存のプレビュータブを同じ位置で差し替える", () => {
    let set = pinned("a.md");
    set = openTab(set, request("b.md", true)).set;
    set = openTab(set, request("c.md", false)).set;
    const previous = set.tabs.find((tab) => tab.preview);

    const result = openTab(
      activateTab(set, previous?.tabId ?? "", 5),
      request("d.md", true),
    );

    expect(summary(result.set)).toEqual([
      ["a.md", "pinned", ""],
      ["d.md", "preview", "active"],
      ["c.md", "pinned", ""],
    ]);
    // 差し替えたタブは新しいIDを持つ。読込中だった応答は照合で捨てられる。
    expect(result.opened?.tabId).not.toBe(previous?.tabId);
  });

  test("プレビューが無ければ、アクティブタブの右に加える", () => {
    let set = pinned("a.md", "b.md");
    set = activateTab(set, set.tabs[0]?.tabId ?? "", 9);

    const result = openTab(set, request("c.md", true));

    expect(summary(result.set)).toEqual([
      ["a.md", "pinned", ""],
      ["c.md", "preview", "active"],
      ["b.md", "pinned", ""],
    ]);
  });

  test.each([
    ["プレビューで開き直すと、固定のまま切り替える", "pinned", true, "pinned"],
    ["固定で開き直すと、プレビューを固定にする", "preview", false, "pinned"],
    ["プレビューで開き直しても、プレビューのまま", "preview", true, "preview"],
  ])("%s（同じ文書は重複させない）", (_, first, preview, expected) => {
    let set = pinned("other.md");
    set = openTab(set, request("a.md", first === "preview")).set;
    set = openTab(set, request("z.md", false)).set;

    const result = openTab(set, request("a.md", preview, 42));

    expect(result.opened).toBeUndefined();
    expect(result.set.tabs).toHaveLength(3);
    const tab = result.set.tabs.find((candidate) => candidate.path === "a.md");
    expect(result.set.activeTabId).toBe(tab?.tabId ?? null);
    expect(tab?.preview ? "preview" : "pinned").toBe(expected);
    expect(tab?.lastActivatedAt).toBe(42);
  });

  test.each([
    [
      "読込中の遷移先と同じ文書を開いても、重複させずにそのタブへ切り替える",
      0,
      false,
    ],
    ["無効になった読込の遷移先は、同じ文書として扱わない", 1, true],
  ])("%s", (_, invalidations, expectOpened) => {
    let set = pinned("a.md", "other.md");
    const first = set.tabs[0];
    // a.md のタブでリンク先 b.md を読み込み始め、文書内の移動などで世代が進んだ。
    set = {
      ...set,
      tabs: set.tabs.map((tab) =>
        tab.tabId === first?.tabId
          ? {
              ...tab,
              loadGeneration: tab.loadGeneration + invalidations,
              pending: { path: "b.md", generation: tab.loadGeneration },
            }
          : tab,
      ),
    };

    const result = openTab(set, request("b.md", true, 50));

    expect(result.opened !== undefined).toBe(expectOpened);
    expect(result.set.tabs).toHaveLength(expectOpened ? 3 : 2);
  });

  test("上限を超えたら、最後にアクティブだった時刻が最も古いタブを閉じる（9.1）", () => {
    const paths = Array.from({ length: MAX_OPEN_TABS }, (_, i) => `${i}.md`);
    let set = pinned(...paths);
    // 先頭のタブを見直し、2番目が最も古くなる。
    set = activateTab(set, set.tabs[0]?.tabId ?? "", 100);

    const result = openTab(set, request("new.md", false, 200));

    expect(result.set.tabs).toHaveLength(MAX_OPEN_TABS);
    expect(result.set.tabs.map((tab) => tab.path)).not.toContain("1.md");
    expect(result.set.tabs.map((tab) => tab.path)).toContain("new.md");
  });
});

describe("closeTab", () => {
  test.each([
    ["中央のアクティブタブを閉じると右隣へ", 1, "c.md"],
    ["右端のアクティブタブを閉じると左隣へ", 2, "b.md"],
  ])("%s", (_, index, expected) => {
    let set = pinned("a.md", "b.md", "c.md");
    set = activateTab(set, set.tabs[index]?.tabId ?? "", 10);

    const closed = closeTab(set, set.tabs[index]?.tabId ?? "", 20);

    const active = closed.tabs.find((tab) => tab.tabId === closed.activeTabId);
    expect(active?.path).toBe(expected);
    expect(active?.lastActivatedAt).toBe(20);
  });

  test("非アクティブタブを閉じてもアクティブは変わらない", () => {
    const set = pinned("a.md", "b.md");
    const closed = closeTab(set, set.tabs[0]?.tabId ?? "", 1);
    expect(closed.activeTabId).toBe(set.activeTabId);
    expect(closed.tabs.map((tab) => tab.path)).toEqual(["b.md"]);
  });

  test("最後のタブを閉じるとアクティブなし", () => {
    const set = pinned("a.md");
    expect(closeTab(set, set.tabs[0]?.tabId ?? "", 1)).toEqual(EMPTY_TAB_SET);
  });
});

describe("タブの移動と固定", () => {
  test.each([
    [0, "next", "b.md"],
    [2, "next", "a.md"],
    [0, "previous", "c.md"],
    [1, "previous", "a.md"],
  ] as const)("%d 番目から %s は %s", (index, direction, expected) => {
    let set = pinned("a.md", "b.md", "c.md");
    set = activateTab(set, set.tabs[index]?.tabId ?? "", 1);
    const id = adjacentTabId(set, direction);
    expect(set.tabs.find((tab) => tab.tabId === id)?.path).toBe(expected);
  });

  test("タブがなければ移動先はない", () => {
    expect(adjacentTabId(EMPTY_TAB_SET, "next")).toBeUndefined();
  });

  test("固定済みのタブを固定しても同じ集合を返す", () => {
    const set = pinned("a.md");
    expect(pinTab(set, set.tabs[0]?.tabId ?? "")).toBe(set);
  });

  test("存在しないタブはアクティブにしない", () => {
    const set = pinned("a.md");
    expect(activateTab(set, "missing", 1)).toBe(set);
  });

  test("タブの名前はパスの最後の要素", () => {
    const set = pinned("docs/sub/guide.md", "README.md");
    expect(set.tabs.map(tabTitle)).toEqual(["guide.md", "README.md"]);
  });
});
