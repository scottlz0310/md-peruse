import { describe, expect, test } from "bun:test";
import type { HistoryEntry } from "./doc-history";
import {
  completeLoad,
  type DocumentTab,
  failLoad,
  type LoadIntent,
  navigateWithin,
  startLoad,
  stepHistory,
} from "./document-tab";

const FRESH = { tabId: "tab-1", scopeId: "scope-1" };

const entry = (path: string, anchor: string | null, scrollTop: number) =>
  ({ path, anchor, scrollTop }) satisfies HistoryEntry;

/** 履歴を直接組み立てたタブ。`path` は現在位置の項目のパスにする。 */
function tabAt(entries: HistoryEntry[], index: number): DocumentTab {
  return {
    ...FRESH,
    path: entries[index]?.path ?? "",
    status: "loaded",
    loadGeneration: 3,
    history: { entries, index },
  };
}

/** 読込を始めて成功させる。 */
function load(
  tab: DocumentTab | null,
  path: string,
  intent: LoadIntent,
  scrollTop = 0,
) {
  const started = startLoad(tab, FRESH, path);
  const done = completeLoad(started.tab, started.token, intent, scrollTop);
  if (done === undefined) throw new Error("読込の応答が捨てられた");
  return done;
}

describe("startLoad / completeLoad", () => {
  test("最初の読込が完了したときに1件目の履歴を積む", () => {
    const { tab, view } = load(null, "a.md", {
      kind: "push",
      path: "a.md",
      anchor: "user-content-x",
    });

    expect(tab.path).toBe("a.md");
    expect(tab.history).toEqual({
      entries: [entry("a.md", "user-content-x", 0)],
      index: 0,
    });
    expect(view).toEqual({ anchor: "user-content-x", scrollTop: 0 });
  });

  test("別の文書へ移るとき、離れる文書のスクロール位置を控える", () => {
    const current = tabAt([entry("a.md", null, 0)], 0);

    const { tab } = load(
      current,
      "b.md",
      { kind: "push", path: "b.md", anchor: null },
      240,
    );

    expect(tab.path).toBe("b.md");
    expect(tab.history).toEqual({
      entries: [entry("a.md", null, 240), entry("b.md", null, 0)],
      index: 1,
    });
  });

  test("後から始めた読込があれば、先の応答を捨てる", () => {
    const first = startLoad(null, FRESH, "slow.md");
    const second = startLoad(first.tab, FRESH, "fast.md");

    expect(
      completeLoad(
        second.tab,
        first.token,
        { kind: "push", path: "slow.md", anchor: null },
        0,
      ),
    ).toBeUndefined();
    expect(
      failLoad(second.tab, first.token, {
        kind: "push",
        path: "slow.md",
        anchor: null,
      }),
    ).toBeUndefined();
  });

  test("削除済みのタブへは読込の結果を反映しない", () => {
    const started = startLoad(
      tabAt([entry("a.md", null, 0)], 0),
      FRESH,
      "a.md",
    );
    const deleted: DocumentTab = { ...started.tab, status: "deleted" };

    expect(
      completeLoad(
        deleted,
        started.token,
        { kind: "push", path: "b.md", anchor: null },
        0,
      ),
    ).toBeUndefined();
  });
});

describe("failLoad", () => {
  test("最初の読込が失敗したらタブを残さない", () => {
    const started = startLoad(null, FRESH, "missing.md");

    expect(
      failLoad(started.tab, started.token, {
        kind: "push",
        path: "missing.md",
        anchor: null,
      }),
    ).toEqual({ tab: null });
  });

  test("リンク先を読めなくても履歴と表示中の文書を保つ（7.2）", () => {
    const current = tabAt([entry("a.md", null, 0)], 0);
    const started = startLoad(current, FRESH, "missing.md");

    const failed = failLoad(started.tab, started.token, {
      kind: "push",
      path: "missing.md",
      anchor: null,
    });

    expect(failed?.tab?.path).toBe("a.md");
    expect(failed?.tab?.history).toEqual(current.history);
  });

  test("戻った先を読めなければ、その項目を履歴から取り除く（9.3）", () => {
    const current = tabAt(
      [entry("gone.md", null, 10), entry("a.md", null, 0)],
      1,
    );
    const step = stepHistory(current, "back", 50);
    if (step?.kind !== "load") throw new Error("読込を求めていない");
    const started = startLoad(current, FRESH, step.path);

    const failed = failLoad(started.tab, started.token, step.intent);

    expect(failed?.tab?.path).toBe("a.md");
    expect(failed?.tab?.history).toEqual({
      entries: [entry("a.md", null, 0)],
      index: 0,
    });
  });
});

describe("navigateWithin", () => {
  test("見出しへの移動を1件として積み、読込中の応答を捨てる", () => {
    const current = tabAt([entry("a.md", null, 0)], 0);
    const pending = startLoad(current, FRESH, "b.md");

    const moved = navigateWithin(pending.tab, "user-content-x", 120);

    expect(moved.tab.history).toEqual({
      entries: [entry("a.md", null, 120), entry("a.md", "user-content-x", 0)],
      index: 1,
    });
    expect(moved.view).toEqual({ anchor: "user-content-x", scrollTop: 0 });
    expect(
      completeLoad(
        moved.tab,
        pending.token,
        { kind: "push", path: "b.md", anchor: null },
        0,
      ),
    ).toBeUndefined();
  });

  test("現在位置と同じ場所は積まない（9.3）", () => {
    const current = tabAt([entry("a.md", "user-content-x", 0)], 0);

    const moved = navigateWithin(current, "user-content-x", 80);

    // スクロール位置はその項目を離れるときに控え直すため、ここでの値は問わない。
    expect(moved.tab.history.entries).toHaveLength(1);
    expect(moved.tab.history.index).toBe(0);
  });
});

describe("stepHistory", () => {
  test.each([
    ["先頭で戻る", 0, "back"],
    ["末尾で進む", 1, "forward"],
  ] as const)("%sときは何もしない", (_, index, direction) => {
    const current = tabAt(
      [entry("a.md", null, 0), entry("a.md", "x", 0)],
      index,
    );

    expect(stepHistory(current, direction, 0)).toBeUndefined();
  });

  test.each([
    ["戻る", 1, "back", 0, 30],
    ["進む", 0, "forward", 1, 70],
  ] as const)(
    "同じ文書の中で%sときは読込なしで、離れたときの位置へ戻す",
    (_, index, direction, expectedIndex, expectedScroll) => {
      const current = tabAt(
        [entry("a.md", null, 30), entry("a.md", "user-content-x", 70)],
        index,
      );

      const step = stepHistory(current, direction, 999);

      expect(step?.kind).toBe("moved");
      if (step?.kind !== "moved") return;
      expect(step.tab.history.index).toBe(expectedIndex);
      expect(step.tab.history.entries[index]?.scrollTop).toBe(999);
      expect(step.view).toEqual({ anchor: null, scrollTop: expectedScroll });
    },
  );

  test("別の文書へ戻るときは、読込の完了で履歴と位置を動かす", () => {
    const current = tabAt(
      [entry("a.md", "user-content-x", 400), entry("b.md", null, 0)],
      1,
    );
    const step = stepHistory(current, "back", 90);
    if (step?.kind !== "load") throw new Error("読込を求めていない");

    const { tab, view } = load(current, step.path, step.intent, 90);

    expect(tab.path).toBe("a.md");
    expect(tab.history).toEqual({
      entries: [entry("a.md", "user-content-x", 400), entry("b.md", null, 90)],
      index: 0,
    });
    expect(view).toEqual({ anchor: null, scrollTop: 400 });
  });

  test("戻ったあとに別の場所へ移ると、進む側を捨てる（9.3）", () => {
    const current = tabAt([entry("a.md", null, 0), entry("b.md", null, 0)], 0);

    const { tab } = load(current, "c.md", {
      kind: "push",
      path: "c.md",
      anchor: null,
    });

    expect(tab.history.entries.map((item) => item.path)).toEqual([
      "a.md",
      "c.md",
    ]);
  });
});
