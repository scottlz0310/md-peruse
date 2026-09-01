import { describe, expect, test } from "bun:test";
import type { FileChange } from "../types/generated/FileChange";
import type { FileChangeEvent } from "../types/generated/FileChangeEvent";
import {
  applyFileChange,
  applyLoadResult,
  beginLoad,
  type TabStatus,
  type TrackedTab,
} from "./tab-status";

const WORKSPACE = "scope-workspace";

const tab = (
  path: string,
  status: TabStatus,
  scopeId = WORKSPACE,
  loadGeneration = 0,
): TrackedTab => ({ scopeId, path, status, loadGeneration });

const event = (change: FileChange, scopeId = WORKSPACE): FileChangeEvent => ({
  scopeId,
  change,
});

describe("applyFileChange", () => {
  const cases: ReadonlyArray<{
    name: string;
    tab: TrackedTab;
    event: FileChangeEvent;
    expected: TrackedTab;
  }> = [
    {
      name: "変更されたファイルを開いているタブはstaleになる",
      tab: tab("docs/a.md", "loaded"),
      event: event({ kind: "fileModified", path: "docs/a.md" }),
      expected: tab("docs/a.md", "stale"),
    },
    {
      name: "別のファイルの変更は影響しない",
      tab: tab("docs/a.md", "loaded"),
      event: event({ kind: "fileModified", path: "docs/b.md" }),
      expected: tab("docs/a.md", "loaded"),
    },
    {
      name: "削除されたファイルを開いているタブはdeletedになる",
      tab: tab("docs/a.md", "stale"),
      event: event({ kind: "fileRemoved", path: "docs/a.md" }),
      expected: tab("docs/a.md", "deleted"),
    },
    {
      name: "renameはパスだけを追従させ、状態は保つ",
      tab: tab("docs/a.md", "stale"),
      event: event({
        kind: "fileRenamed",
        path: "docs/b.md",
        oldPath: "docs/a.md",
      }),
      expected: tab("docs/b.md", "stale"),
    },
    {
      name: "rename後のパスと一致するだけのタブは追従しない",
      tab: tab("docs/b.md", "loaded"),
      event: event({
        kind: "fileRenamed",
        path: "docs/b.md",
        oldPath: "docs/a.md",
      }),
      expected: tab("docs/b.md", "loaded"),
    },
    {
      name: "ディレクトリの増減はタブへ影響しない",
      tab: tab("docs/a.md", "loaded"),
      event: event({ kind: "directoryChanged", path: "docs" }),
      expected: tab("docs/a.md", "loaded"),
    },
  ];

  for (const { name, tab: input, event: change, expected } of cases) {
    test(name, () => {
      expect(applyFileChange(input, change)).toEqual(expected);
    });
  }

  // 暗黙のルートが異なるloose tabは同じ相対パスを持ちうる（`C:\A\README.md` と
  // `C:\B\README.md` はどちらも `README.md`）。スコープで区別する（6.4）。
  test("同じ相対パスでもスコープが違えば適用しない", () => {
    const looseA = tab("README.md", "loaded", "scope-loose-a");
    expect(
      applyFileChange(
        looseA,
        event({ kind: "fileModified", path: "README.md" }, "scope-loose-b"),
      ),
    ).toBe(looseA);
  });

  test("同じスコープの同じ相対パスには適用する", () => {
    const looseA = tab("README.md", "loaded", "scope-loose-a");
    expect(
      applyFileChange(
        looseA,
        event({ kind: "fileModified", path: "README.md" }, "scope-loose-a"),
      ),
    ).toEqual(tab("README.md", "stale", "scope-loose-a"));
  });

  // 切替前にWatcherが送出したイベントが切替後に配送されると、新旧のルートで
  // 同じ相対パスが衝突する。旧スコープのイベントは破棄する（6.4）。
  test("ワークスペース切替後に届いた旧スコープのイベントは破棄する", () => {
    const current = tab("docs/a.md", "loaded", "scope-workspace-2");
    expect(
      applyFileChange(
        current,
        event({ kind: "fileRemoved", path: "docs/a.md" }, "scope-workspace-1"),
      ),
    ).toBe(current);
  });

  // 削除は debounce 窓で置換とrenameを除いてから確定するため、deleted の後に
  // 同じパスのイベントが続いても状態を戻さない（design-decisions.md 6.4、6.5）。
  const terminalCases: ReadonlyArray<{ name: string; change: FileChange }> = [
    { name: "変更", change: { kind: "fileModified", path: "docs/a.md" } },
    {
      name: "rename",
      change: { kind: "fileRenamed", path: "docs/b.md", oldPath: "docs/a.md" },
    },
  ];

  for (const { name, change } of terminalCases) {
    test(`削除済みタブは${name}を受けても変化しない`, () => {
      const deleted = tab("docs/a.md", "deleted");
      expect(applyFileChange(deleted, event(change))).toBe(deleted);
    });
  }

  test("変化がないときは同じ参照を返す", () => {
    const input = tab("docs/a.md", "loaded");
    expect(
      applyFileChange(
        input,
        event({ kind: "fileModified", path: "docs/b.md" }),
      ),
    ).toBe(input);
  });

  test("タブが持つ他のフィールドを保つ", () => {
    const input = { ...tab("docs/a.md", "loaded"), scrollTop: 320 };
    expect(
      applyFileChange(
        input,
        event({ kind: "fileModified", path: "docs/a.md" }),
      ),
    ).toEqual({
      ...tab("docs/a.md", "stale"),
      scrollTop: 320,
    });
  });
});

describe("beginLoad / applyLoadResult", () => {
  test("読込の開始で世代が進む", () => {
    expect(beginLoad(tab("docs/a.md", "stale")).loadGeneration).toBe(1);
  });

  test("最新の世代の応答は loaded として反映する", () => {
    const started = beginLoad(tab("docs/a.md", "stale"));
    expect(
      applyLoadResult(started, started.loadGeneration, "succeeded"),
    ).toEqual(tab("docs/a.md", "loaded", WORKSPACE, 1));
  });

  // 置換直後の再読込（6.5）は同じタブに対して短い間隔で2回の読込を走らせる。
  // 先に始めた読込Aが後から完了しても、新しい内容を古い内容で上書きしない。
  test("完了順が反転しても古い世代の応答は破棄する", () => {
    const a = beginLoad(tab("docs/a.md", "stale"));
    const b = beginLoad(a);
    const afterB = applyLoadResult(b, b.loadGeneration, "succeeded");
    expect(afterB.status).toBe("loaded");

    const afterA = applyLoadResult(afterB, a.loadGeneration, "succeeded");
    expect(afterA).toBe(afterB);
  });

  test("失敗した応答では状態を変えない", () => {
    const started = beginLoad(tab("docs/a.md", "stale"));
    expect(applyLoadResult(started, started.loadGeneration, "failed")).toBe(
      started,
    );
  });

  test("読込中に削除が確定したタブへは反映しない", () => {
    const started = beginLoad(tab("docs/a.md", "stale"));
    const deleted = applyFileChange(
      started,
      event({ kind: "fileRemoved", path: "docs/a.md" }),
    );
    expect(applyLoadResult(deleted, started.loadGeneration, "succeeded")).toBe(
      deleted,
    );
  });
});
