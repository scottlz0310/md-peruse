import { describe, expect, test } from "bun:test";
import type { FileChangeEvent } from "../types/generated/FileChangeEvent";
import { applyFileChange, type TabStatus, type TrackedTab } from "./tab-status";

const tab = (path: string, status: TabStatus): TrackedTab => ({ path, status });

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
      event: { kind: "fileModified", path: "docs/a.md" },
      expected: tab("docs/a.md", "stale"),
    },
    {
      name: "別のファイルの変更は影響しない",
      tab: tab("docs/a.md", "loaded"),
      event: { kind: "fileModified", path: "docs/b.md" },
      expected: tab("docs/a.md", "loaded"),
    },
    {
      name: "削除されたファイルを開いているタブはdeletedになる",
      tab: tab("docs/a.md", "stale"),
      event: { kind: "fileRemoved", path: "docs/a.md" },
      expected: tab("docs/a.md", "deleted"),
    },
    {
      name: "renameはパスだけを追従させ、状態は保つ",
      tab: tab("docs/a.md", "stale"),
      event: { kind: "fileRenamed", path: "docs/b.md", oldPath: "docs/a.md" },
      expected: tab("docs/b.md", "stale"),
    },
    {
      name: "rename後のパスと一致するだけのタブは追従しない",
      tab: tab("docs/b.md", "loaded"),
      event: { kind: "fileRenamed", path: "docs/b.md", oldPath: "docs/a.md" },
      expected: tab("docs/b.md", "loaded"),
    },
    {
      name: "ディレクトリの増減はタブへ影響しない",
      tab: tab("docs/a.md", "loaded"),
      event: { kind: "directoryChanged", path: "docs" },
      expected: tab("docs/a.md", "loaded"),
    },
  ];

  for (const { name, tab: input, event, expected } of cases) {
    test(name, () => {
      expect(applyFileChange(input, event)).toEqual(expected);
    });
  }

  // 削除は debounce 窓で置換とrenameを除いてから確定するため、deleted の後に
  // 同じパスのイベントが続いても状態を戻さない（design-decisions.md 6.4、6.5）。
  const terminalCases: ReadonlyArray<{ name: string; event: FileChangeEvent }> =
    [
      { name: "変更", event: { kind: "fileModified", path: "docs/a.md" } },
      {
        name: "rename",
        event: { kind: "fileRenamed", path: "docs/b.md", oldPath: "docs/a.md" },
      },
    ];

  for (const { name, event } of terminalCases) {
    test(`削除済みタブは${name}を受けても変化しない`, () => {
      const deleted = tab("docs/a.md", "deleted");
      expect(applyFileChange(deleted, event)).toBe(deleted);
    });
  }

  test("変化がないときは同じ参照を返す", () => {
    const input = tab("docs/a.md", "loaded");
    expect(
      applyFileChange(input, { kind: "fileModified", path: "docs/b.md" }),
    ).toBe(input);
  });

  test("タブが持つ他のフィールドを保つ", () => {
    const input = {
      path: "docs/a.md",
      status: "loaded" as const,
      scrollTop: 320,
    };
    expect(
      applyFileChange(input, { kind: "fileModified", path: "docs/a.md" }),
    ).toEqual({
      path: "docs/a.md",
      status: "stale",
      scrollTop: 320,
    });
  });
});
