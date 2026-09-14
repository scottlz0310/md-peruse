import { describe, expect, test } from "bun:test";
import type { FileNode } from "../types/generated/FileNode";
import {
  applyScanResult,
  beginScan,
  createFileTree,
  type FileTree,
  needsScan,
  ROOT_PATH,
  setExpanded,
  visibleNodes,
} from "./file-tree";

const dir = (path: string): FileNode => ({
  path,
  name: path.split("/").pop() ?? path,
  kind: "directory",
  hasChildren: true,
});

const file = (path: string): FileNode => ({
  path,
  name: path.split("/").pop() ?? path,
  kind: "markdown",
  hasChildren: null,
});

/** ルート直下を読み込んだツリー。 */
function loadedRoot(entries: FileNode[], generation = 1): FileTree {
  const started = beginScan(createFileTree(generation), ROOT_PATH);
  const done = applyScanResult(started.tree, started.token, { entries });
  if (done === undefined) throw new Error("ルートの反映に失敗した");
  return done;
}

describe("走査の世代（5.3）", () => {
  test("同じパスを再走査したら、先に始めた走査の応答は反映しない", () => {
    const tree = loadedRoot([dir("a")]);
    const first = beginScan(tree, "a");
    const second = beginScan(first.tree, "a");

    // 後から始めた走査が先に届く。
    const newer = applyScanResult(second.tree, second.token, {
      entries: [file("a/new.md")],
    });
    expect(newer).toBeDefined();
    // 先に始めた走査が後から届いても上書きしない。
    expect(
      applyScanResult(newer as FileTree, first.token, {
        entries: [file("a/old.md")],
      }),
    ).toBeUndefined();
    expect(newer?.directories.get("a")).toEqual({
      status: "loaded",
      entries: [file("a/new.md")],
    });
  });

  test("別のパスの走査は互いに無効化しない", () => {
    const tree = loadedRoot([dir("a"), dir("b")]);
    const a = beginScan(tree, "a");
    const b = beginScan(a.tree, "b");

    const afterB = applyScanResult(b.tree, b.token, {
      entries: [file("b/x.md")],
    });
    const afterA = applyScanResult(afterB as FileTree, a.token, {
      entries: [file("a/y.md")],
    });

    expect(afterA?.directories.get("a")?.status).toBe("loaded");
    expect(afterA?.directories.get("b")?.status).toBe("loaded");
  });

  test("ワークスペースを切り替えたら、旧ワークスペースの応答は同じパスでも反映しない", () => {
    const old = beginScan(createFileTree(1), ROOT_PATH);
    const current = beginScan(createFileTree(2), ROOT_PATH);

    // 新しいツリーのパス世代は旧ツリーと同じ値から始まる。照合はワークスペース世代で落とす。
    expect(current.token.pathGeneration).toBe(old.token.pathGeneration);
    expect(
      applyScanResult(current.tree, old.token, { entries: [file("old.md")] }),
    ).toBeUndefined();
  });
});

describe("取得状態", () => {
  test("再走査の間は取得済みの結果を表示し続ける", () => {
    const tree = loadedRoot([file("a.md")]);
    const again = beginScan(tree, ROOT_PATH);
    expect(again.tree.directories.get(ROOT_PATH)?.status).toBe("loaded");
  });

  test("失敗はそのフォルダーに記録する", () => {
    const tree = loadedRoot([dir("locked")]);
    const started = beginScan(tree, "locked");
    const failed = applyScanResult(started.tree, started.token, {
      message: "アクセスできません",
    });
    expect(failed?.directories.get("locked")).toEqual({
      status: "failed",
      message: "アクセスできません",
    });
    expect(failed?.directories.get(ROOT_PATH)?.status).toBe("loaded");
  });

  test.each([
    ["未取得", undefined, true],
    ["読込中", { status: "loading" } as const, false],
    ["取得済み", { status: "loaded", entries: [] } as const, false],
    ["失敗", { status: "failed", message: "x" } as const, true],
  ])("%sのフォルダーを展開したときの走査要否", (_, state, expected) => {
    const base = createFileTree(1);
    const tree: FileTree =
      state === undefined
        ? base
        : { ...base, directories: new Map([["a", state]]) };
    expect(needsScan(tree, "a")).toBe(expected);
  });
});

describe("visibleNodes", () => {
  test("展開したフォルダーの中身だけを深さ優先で並べる", () => {
    let tree = loadedRoot([dir("a"), dir("b"), file("c.md")]);
    for (const [path, entries] of [
      ["a", [dir("a/sub"), file("a/x.md")]],
      ["a/sub", [file("a/sub/y.md")]],
      ["b", [file("b/z.md")]],
    ] as const) {
      const started = beginScan(tree, path);
      tree = applyScanResult(started.tree, started.token, {
        entries: [...entries],
      }) as FileTree;
    }
    tree = setExpanded(tree, "a", true);
    tree = setExpanded(tree, "a/sub", true);

    expect(
      visibleNodes(tree).map(({ node, level, parent }) => [
        node.path,
        level,
        parent,
      ]),
    ).toEqual([
      ["a", 1, ""],
      ["a/sub", 2, "a"],
      ["a/sub/y.md", 3, "a/sub"],
      ["a/x.md", 2, "a"],
      ["b", 1, ""],
      ["c.md", 1, ""],
    ]);

    // 親を畳むと、展開状態を覚えている子孫も見えなくなる。
    tree = setExpanded(tree, "a", false);
    expect(visibleNodes(tree).map(({ node }) => node.path)).toEqual([
      "a",
      "b",
      "c.md",
    ]);
  });

  test("展開状態が変わらない操作は同じツリーを返す", () => {
    const tree = loadedRoot([dir("a")]);
    expect(setExpanded(tree, "a", false)).toBe(tree);
  });
});
