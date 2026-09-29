import { describe, expect, test } from "bun:test";
import type { FileNode } from "../types/generated/FileNode";
import {
  applyScanResult,
  beginScan,
  createFileTree,
  type DirectoryState,
  type FileTree,
  needsScan,
  pathChain,
  ROOT_PATH,
  refreshAllDirectories,
  refreshDirectory,
  revealFocus,
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

/** 読み込み済みのフォルダーを足す。`open` なら展開もする。 */
function withDirectory(
  tree: FileTree,
  path: string,
  entries: FileNode[],
  open: boolean,
): FileTree {
  const started = beginScan(tree, path);
  const done = applyScanResult(started.tree, started.token, { entries });
  if (done === undefined) throw new Error("フォルダーの反映に失敗した");
  return setExpanded(done, path, open);
}

describe("子要素の増減の通知（6.4）", () => {
  test("展開しているフォルダーは、その階層だけを取り直す", () => {
    const tree = withDirectory(
      loadedRoot([dir("a"), dir("b")]),
      "a",
      [file("a/x.md")],
      true,
    );

    expect(refreshDirectory(tree, "a")).toEqual({ tree, rescan: ["a"] });
    // ルートは常に見えている。
    expect(refreshDirectory(tree, ROOT_PATH)).toEqual({
      tree,
      rescan: [ROOT_PATH],
    });
  });

  test("畳んでいる取得済みのフォルダーは、取得結果を捨てて次の展開で取り直させる", () => {
    const tree = withDirectory(
      loadedRoot([dir("a")]),
      "a",
      [file("a/x.md")],
      false,
    );

    const { tree: after, rescan } = refreshDirectory(tree, "a");

    expect(rescan).toEqual([]);
    expect(after.directories.has("a")).toBe(false);
    expect(needsScan(after, "a")).toBe(true);
    // 捨てる前に始めた走査の応答は反映しない。
    const late = beginScan(tree, "a");
    expect(
      applyScanResult(refreshDirectory(late.tree, "a").tree, late.token, {
        entries: [file("a/old.md")],
      }),
    ).toBeUndefined();
  });

  test("走査中の展開しているフォルダーは、取り直して先の応答を無効にする", () => {
    const opened = setExpanded(loadedRoot([dir("a")]), "a", true);
    const first = beginScan(opened, "a");

    const { tree, rescan } = refreshDirectory(first.tree, "a");
    expect(rescan).toEqual(["a"]);
    const second = beginScan(tree, "a");

    expect(
      applyScanResult(second.tree, first.token, { entries: [] }),
    ).toBeUndefined();
  });

  test.each([
    ["取得していない", "b"],
    ["失敗した", "locked"],
  ])("%sフォルダーの通知では何もしない", (_, path) => {
    const base = loadedRoot([dir("locked"), dir("b")]);
    const started = beginScan(base, "locked");
    const tree = applyScanResult(started.tree, started.token, {
      message: "アクセスできません",
    }) as FileTree;

    expect(refreshDirectory(tree, path)).toEqual({ tree, rescan: [] });
  });

  test("子を持たないと表示していたフォルダーに子ができたら、親を取り直す", () => {
    const empty: FileNode = { ...dir("empty"), hasChildren: false };
    const tree = loadedRoot([empty, dir("other")]);

    expect(refreshDirectory(tree, "empty")).toEqual({
      tree,
      rescan: [ROOT_PATH],
    });
    // 子を持つと表示しているフォルダーは、展開するまで取り直す理由がない。
    expect(refreshDirectory(tree, "other")).toEqual({ tree, rescan: [] });
  });

  test("すべてを取り直すときは、展開しているものを取り直し、畳んでいるものは捨てる", () => {
    let tree = loadedRoot([dir("a"), dir("b")]);
    tree = withDirectory(tree, "a", [file("a/x.md")], true);
    tree = withDirectory(tree, "b", [file("b/y.md")], false);

    const { tree: after, rescan } = refreshAllDirectories(tree);

    expect([...rescan].sort()).toEqual([ROOT_PATH, "a"].sort());
    expect(after.directories.has("b")).toBe(false);
    expect(after.directories.has("a")).toBe(true);
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

describe("pathChain", () => {
  test.each([
    ["docs/guide/a.md", ["docs", "docs/guide", "docs/guide/a.md"]],
    ["README.md", ["README.md"]],
    [ROOT_PATH, []],
  ])("%s", (path, expected) => {
    expect(pathChain(path)).toEqual(expected);
  });
});

describe("revealFocus（10.1.1）", () => {
  const loaded = (...entries: FileNode[]): DirectoryState => ({
    status: "loaded",
    entries,
  });
  const loading: DirectoryState = { status: "loading" };
  const failed: DirectoryState = { status: "failed", message: "x" };

  /** a/ と x.md を持つルート。a と a/b を展開済みにする。 */
  function treeWith(states: [string, DirectoryState][]): FileTree {
    const tree: FileTree = {
      ...createFileTree(1),
      directories: new Map([
        [ROOT_PATH, loaded(dir("a"), file("x.md"))],
        ...states,
      ]),
    };
    return setExpanded(setExpanded(tree, "a", true), "a/b", true);
  }

  test.each<
    [string, [string, DirectoryState][], string, string | null, boolean]
  >([
    ["見えている項目", [["a", loaded(dir("a/b"))]], "a/b", "a/b", true],
    ["祖先の走査中は見えている祖先で待つ", [["a", loading]], "a/b", "a", false],
    [
      "深い階層でも最も近い祖先で待つ",
      [
        ["a", loaded(dir("a/b"))],
        ["a/b", loading],
      ],
      "a/b/c",
      "a/b",
      false,
    ],
    ["祖先の走査に失敗したらそこで止まる", [["a", failed]], "a/b", "a", true],
    ["ルートは先頭の項目", [], ROOT_PATH, "a", true],
  ])("%s", (_, states, path, expected, done) => {
    expect(revealFocus(treeWith(states), path)).toEqual({
      path: expected,
      done,
    });
  });

  test.each<[string, DirectoryState, boolean]>([
    ["走査中", loading, false],
    ["失敗", failed, true],
  ])("ルートが%sで項目がなければ置き場所はない", (_, root, done) => {
    const tree: FileTree = {
      ...createFileTree(1),
      directories: new Map([[ROOT_PATH, root]]),
    };
    expect(revealFocus(tree, ROOT_PATH)).toEqual({ path: null, done });
    expect(revealFocus(tree, "a")).toEqual({ path: null, done });
  });
});
