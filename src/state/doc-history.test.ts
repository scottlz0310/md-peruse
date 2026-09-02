import { describe, expect, test } from "bun:test";
import {
  canGoBack,
  canGoForward,
  createHistory,
  currentEntry,
  goBack,
  goForward,
  type HistoryEntry,
  MAX_HISTORY_ENTRIES,
  pushHistoryEntry,
  removeHistoryEntryAt,
  renameHistoryPath,
  type TabHistory,
  updateCurrentScroll,
} from "./doc-history";

const entry = (
  path: string,
  anchor: string | null = null,
  scrollTop = 0,
): HistoryEntry => ({ path, anchor, scrollTop });

/** `entries` と `index` を直接組み立てる。途中まで戻った状態を作るために使う。 */
const history = (
  entries: readonly HistoryEntry[],
  index: number,
): TabHistory => ({
  entries,
  index,
});

describe("createHistory", () => {
  test("1件から始まり、どちらへも動けない", () => {
    const created = createHistory(entry("a.md"));
    expect(created.entries).toHaveLength(1);
    expect(created.index).toBe(0);
    expect(canGoBack(created)).toBe(false);
    expect(canGoForward(created)).toBe(false);
  });
});

describe("pushHistoryEntry", () => {
  const cases: ReadonlyArray<{
    name: string;
    initial: TabHistory;
    pushed: HistoryEntry;
    expectedPaths: readonly string[];
    expectedIndex: number;
  }> = [
    {
      name: "末尾へ積む",
      initial: createHistory(entry("a.md")),
      pushed: entry("b.md"),
      expectedPaths: ["a.md", "b.md"],
      expectedIndex: 1,
    },
    {
      name: "戻った状態で積むと進む側を捨てる",
      initial: history([entry("a.md"), entry("b.md"), entry("c.md")], 0),
      pushed: entry("d.md"),
      expectedPaths: ["a.md", "d.md"],
      expectedIndex: 1,
    },
    {
      name: "同じ文書でもアンカーが違えば積む",
      initial: createHistory(entry("a.md")),
      pushed: entry("a.md", "user-content-section"),
      expectedPaths: ["a.md", "a.md"],
      expectedIndex: 1,
    },
    {
      name: "同じ文書の同じアンカーは積まない",
      initial: createHistory(entry("a.md", "user-content-section")),
      pushed: entry("a.md", "user-content-section"),
      expectedPaths: ["a.md"],
      expectedIndex: 0,
    },
    {
      name: "ツリーやパンくず由来でも同じ規則で積む",
      initial: createHistory(entry("docs/a.md")),
      pushed: entry("docs/sub/b.md"),
      expectedPaths: ["docs/a.md", "docs/sub/b.md"],
      expectedIndex: 1,
    },
  ];

  for (const { name, initial, pushed, expectedPaths, expectedIndex } of cases) {
    test(name, () => {
      const next = pushHistoryEntry(initial, pushed);
      expect(next.entries.map((e) => e.path)).toEqual([...expectedPaths]);
      expect(next.index).toBe(expectedIndex);
    });
  }

  test("同じ場所を積み直してもスクロール位置は更新する", () => {
    const initial = createHistory(entry("a.md", null, 120));
    const next = pushHistoryEntry(initial, entry("a.md", null, 480));
    expect(next.entries).toHaveLength(1);
    expect(currentEntry(next)?.scrollTop).toBe(480);
  });

  test("上限を超えると最も古い項目を捨てる", () => {
    let acc = createHistory(entry("0.md"));
    for (let i = 1; i <= MAX_HISTORY_ENTRIES; i += 1) {
      acc = pushHistoryEntry(acc, entry(`${i}.md`));
    }
    expect(acc.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(acc.entries[0]?.path).toBe("1.md");
    expect(acc.index).toBe(MAX_HISTORY_ENTRIES - 1);
    expect(currentEntry(acc)?.path).toBe(`${MAX_HISTORY_ENTRIES}.md`);
  });
});

describe("goBack / goForward", () => {
  test("戻って進むと元の位置へ返る", () => {
    const initial = history([entry("a.md"), entry("b.md"), entry("c.md")], 2);
    const back = goBack(goBack(initial));
    expect(currentEntry(back)?.path).toBe("a.md");
    const forward = goForward(goForward(back));
    expect(currentEntry(forward)?.path).toBe("c.md");
  });

  test("端では動かない", () => {
    const initial = createHistory(entry("a.md"));
    expect(goBack(initial)).toBe(initial);
    expect(goForward(initial)).toBe(initial);
  });

  test("端かどうかを判定できる", () => {
    const middle = history([entry("a.md"), entry("b.md"), entry("c.md")], 1);
    expect(canGoBack(middle)).toBe(true);
    expect(canGoForward(middle)).toBe(true);
  });
});

describe("updateCurrentScroll", () => {
  test("現在位置だけを更新する", () => {
    const initial = history(
      [entry("a.md", null, 10), entry("b.md", null, 20)],
      1,
    );
    const next = updateCurrentScroll(initial, 640);
    expect(next.entries[0]?.scrollTop).toBe(10);
    expect(next.entries[1]?.scrollTop).toBe(640);
  });

  test("値が変わらなければ同じ履歴を返す", () => {
    const initial = createHistory(entry("a.md", null, 10));
    expect(updateCurrentScroll(initial, 10)).toBe(initial);
  });
});

describe("removeHistoryEntryAt", () => {
  const cases: ReadonlyArray<{
    name: string;
    initial: TabHistory;
    target: number;
    expectedPaths: readonly string[];
    expectedIndex: number;
  }> = [
    {
      name: "現在位置より前を取り除くと現在位置が詰まる",
      initial: history([entry("a.md"), entry("b.md"), entry("c.md")], 2),
      target: 0,
      expectedPaths: ["b.md", "c.md"],
      expectedIndex: 1,
    },
    {
      name: "現在位置を取り除くと同じ添字が次の項目を指す",
      initial: history([entry("a.md"), entry("b.md"), entry("c.md")], 1),
      target: 1,
      expectedPaths: ["a.md", "c.md"],
      expectedIndex: 1,
    },
    {
      name: "末尾の現在位置を取り除くと1つ前へ下がる",
      initial: history([entry("a.md"), entry("b.md")], 1),
      target: 1,
      expectedPaths: ["a.md"],
      expectedIndex: 0,
    },
    {
      name: "最後の1件を取り除くと空になる",
      initial: createHistory(entry("a.md")),
      target: 0,
      expectedPaths: [],
      expectedIndex: 0,
    },
    {
      name: "範囲外の添字では何もしない",
      initial: createHistory(entry("a.md")),
      target: 3,
      expectedPaths: ["a.md"],
      expectedIndex: 0,
    },
  ];

  for (const { name, initial, target, expectedPaths, expectedIndex } of cases) {
    test(name, () => {
      const next = removeHistoryEntryAt(initial, target);
      expect(next.entries.map((e) => e.path)).toEqual([...expectedPaths]);
      expect(next.index).toBe(expectedIndex);
    });
  }
});

describe("renameHistoryPath", () => {
  test("該当する項目のパスをすべて差し替える", () => {
    const initial = history(
      [entry("old.md"), entry("other.md"), entry("old.md", "user-content-x")],
      2,
    );
    const next = renameHistoryPath(initial, "old.md", "new.md");
    expect(next.entries.map((e) => e.path)).toEqual([
      "new.md",
      "other.md",
      "new.md",
    ]);
    expect(next.index).toBe(2);
  });

  test("一致する項目がなければ同じ履歴を返す", () => {
    const initial = createHistory(entry("a.md"));
    expect(renameHistoryPath(initial, "missing.md", "new.md")).toBe(initial);
  });

  test("アンカーとスクロール位置は保つ", () => {
    const initial = createHistory(entry("old.md", "user-content-x", 320));
    const moved = currentEntry(renameHistoryPath(initial, "old.md", "new.md"));
    expect(moved).toEqual({
      path: "new.md",
      anchor: "user-content-x",
      scrollTop: 320,
    });
  });
});
