import { describe, expect, test } from "bun:test";
import {
  type EvictionCandidate,
  MAX_OPEN_TABS,
  selectEvictableTab,
} from "./tabs";

const candidate = (
  tabId: string,
  lastActivatedAt: number,
): EvictionCandidate => ({
  tabId,
  lastActivatedAt,
});

describe("selectEvictableTab", () => {
  const cases: ReadonlyArray<{
    name: string;
    tabs: readonly EvictionCandidate[];
    activeTabId: string;
    expected: string | undefined;
  }> = [
    {
      name: "最終アクティブ時刻が最も古い非アクティブタブを選ぶ",
      tabs: [candidate("a", 300), candidate("b", 100), candidate("c", 200)],
      activeTabId: "a",
      expected: "b",
    },
    {
      name: "アクティブタブが最も古くても選ばない",
      tabs: [candidate("a", 100), candidate("b", 200), candidate("c", 300)],
      activeTabId: "a",
      expected: "b",
    },
    {
      name: "並び順ではなく時刻で選ぶ",
      tabs: [candidate("a", 100), candidate("b", 400), candidate("c", 200)],
      activeTabId: "b",
      expected: "a",
    },
    {
      name: "時刻が同じなら渡された順で先のものを選ぶ",
      tabs: [candidate("a", 100), candidate("b", 100), candidate("c", 100)],
      activeTabId: "c",
      expected: "a",
    },
    {
      name: "アクティブタブしかなければ候補がない",
      tabs: [candidate("a", 100)],
      activeTabId: "a",
      expected: undefined,
    },
    {
      name: "タブがなければ候補がない",
      tabs: [],
      activeTabId: "a",
      expected: undefined,
    },
  ];

  for (const { name, tabs, activeTabId, expected } of cases) {
    test(name, () => {
      expect(selectEvictableTab(tabs, activeTabId)?.tabId).toBe(expected);
    });
  }

  // 削除済みタブも候補に含める（design-decisions.md 9.1）。退避規則を状態で分けると、
  // 「候補がないときの振る舞い」を起動経路ごとに抱えることになる。
  test("状態を持つタブでも最終アクティブ時刻だけで選ぶ", () => {
    const tabs = [
      { tabId: "a", lastActivatedAt: 300, status: "loaded" as const },
      { tabId: "b", lastActivatedAt: 100, status: "deleted" as const },
      { tabId: "c", lastActivatedAt: 200, status: "stale" as const },
    ];
    expect(selectEvictableTab(tabs, "a")).toBe(tabs[1]);
  });
});

describe("MAX_OPEN_TABS", () => {
  // 上限を下げるときは、関連付け起動で複数ファイルを渡された場合に開いた端から
  // 閉じる範囲が広がることを踏まえる（design-decisions.md 9.2）。
  test("エクスプローラーの複数選択で警告が出る件数より大きい", () => {
    expect(MAX_OPEN_TABS).toBeGreaterThan(15);
  });
});
