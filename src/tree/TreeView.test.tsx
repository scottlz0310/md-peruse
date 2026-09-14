import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  applyScanResult,
  beginScan,
  createFileTree,
  type FileTree,
  ROOT_PATH,
  setExpanded,
} from "../state/file-tree";
import type { FileNode } from "../types/generated/FileNode";
import { TreeView } from "./TreeView";

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

function load(tree: FileTree, path: string, entries: FileNode[]): FileTree {
  const started = beginScan(tree, path);
  return applyScanResult(started.tree, started.token, { entries }) as FileTree;
}

/**
 * docs/（展開済み: guide.md）、empty/（未展開）、README.md の並び。
 */
function sampleTree(): FileTree {
  let tree = load(createFileTree(1), ROOT_PATH, [
    dir("docs"),
    dir("empty"),
    file("README.md"),
  ]);
  tree = load(tree, "docs", [file("docs/guide.md")]);
  return setExpanded(tree, "docs", true);
}

function mount(tree: FileTree, selectedPath: string | null = null) {
  const toggled: [string, boolean][] = [];
  const opened: string[] = [];
  render(
    <TreeView
      tree={tree}
      selectedPath={selectedPath}
      onToggle={(path, expanded) => toggled.push([path, expanded])}
      onOpen={(path) => opened.push(path)}
    />,
  );
  return { toggled, opened };
}

const item = (name: string) => screen.getByRole("treeitem", { name });

afterEach(cleanup);

describe("TreeView", () => {
  test("ARIAの階層、展開状態、選択を示し、フォーカスを1項目だけに持たせる", () => {
    mount(sampleTree(), "docs/guide.md");

    expect(screen.getByRole("tree")).toBeTruthy();
    const docs = item("docs guide.md");
    expect(docs.getAttribute("aria-level")).toBe("1");
    expect(docs.getAttribute("aria-expanded")).toBe("true");
    expect(item("empty").getAttribute("aria-expanded")).toBe("false");
    const guide = item("guide.md");
    expect(guide.getAttribute("aria-level")).toBe("2");
    expect(guide.getAttribute("aria-expanded")).toBeNull();
    expect(guide.getAttribute("aria-selected")).toBe("true");
    // まだ動かしていなければ、表示中の文書にフォーカスを持たせる。
    expect(
      screen
        .getAllByRole("treeitem")
        .filter((element) => element.tabIndex === 0),
    ).toEqual([guide]);
  });

  test.each([
    ["ArrowDown", "docs guide.md", "guide.md"],
    ["ArrowUp", "guide.md", "docs guide.md"],
    ["Home", "README.md", "docs guide.md"],
    ["End", "docs guide.md", "README.md"],
    // 展開済みのフォルダーでは最初の子へ移る。
    ["ArrowRight", "docs guide.md", "guide.md"],
    // 子からは親へ移る。
    ["ArrowLeft", "guide.md", "docs guide.md"],
  ])("%s で %s から %s へ移る", (key, from, to) => {
    mount(sampleTree());
    const start = item(from);
    start.focus();

    fireEvent.keyDown(start, { key });

    expect(document.activeElement).toBe(item(to));
    expect(item(to).tabIndex).toBe(0);
  });

  test.each([
    ["ArrowRight", "empty", [["empty", true]], []],
    ["ArrowLeft", "docs guide.md", [["docs", false]], []],
    ["Enter", "empty", [["empty", true]], []],
    ["Enter", "README.md", [], ["README.md"]],
    // ファイルの `→` とルート直下の `←` は何もしない。
    ["ArrowRight", "README.md", [], []],
    ["ArrowLeft", "README.md", [], []],
  ])("%s を %s で押すと開閉または開く", (key, name, toggled, opened) => {
    const calls = mount(sampleTree());
    const target = item(name);
    target.focus();

    fireEvent.keyDown(target, { key });

    expect(calls.toggled).toEqual(toggled as [string, boolean][]);
    expect(calls.opened).toEqual(opened);
  });

  test("子を持たないフォルダーは展開矢印を出さず、展開の操作を受けない（6.2）", () => {
    const tree = load(createFileTree(1), ROOT_PATH, [
      { ...dir("leaf"), hasChildren: false },
    ]);
    const calls = mount(tree);
    const leaf = item("leaf");

    expect(leaf.getAttribute("aria-expanded")).toBeNull();
    expect(leaf.querySelector(".tree-toggle")?.textContent).toBe("");
    leaf.focus();
    fireEvent.keyDown(leaf, { key: "Enter" });
    fireEvent.keyDown(leaf, { key: "ArrowRight" });
    fireEvent.click(screen.getByText("leaf"));

    expect(calls.toggled).toEqual([]);
    expect(calls.opened).toEqual([]);
  });

  test("ほかのキーは既定動作を止めない", () => {
    mount(sampleTree());
    const target = item("README.md");
    target.focus();
    expect(fireEvent.keyDown(target, { key: "Tab" })).toBe(true);
  });

  test("クリックでフォルダーを開閉し、ファイルを開く", () => {
    const calls = mount(sampleTree());

    fireEvent.click(screen.getByText("docs"));
    fireEvent.click(screen.getByText("README.md"));

    expect(calls.toggled).toEqual([["docs", false]]);
    expect(calls.opened).toEqual(["README.md"]);
    expect(document.activeElement).toBe(item("README.md"));
  });

  test("畳まれて見えなくなった項目のフォーカスは、見えている親へ移す", () => {
    const tree = sampleTree();
    const { rerender } = render(
      <TreeView
        tree={tree}
        selectedPath={null}
        onToggle={() => {}}
        onOpen={() => {}}
      />,
    );
    const guide = item("guide.md");
    guide.focus();

    rerender(
      <TreeView
        tree={setExpanded(tree, "docs", false)}
        selectedPath={null}
        onToggle={() => {}}
        onOpen={() => {}}
      />,
    );

    expect(item("docs").tabIndex).toBe(0);
  });

  test.each([
    [{ status: "loading" } as const, "読み込み中…"],
    [
      { status: "failed", message: "アクセスできません" } as const,
      "アクセスできません",
    ],
  ])("展開したフォルダーの取得状態を中に示す", (state, text) => {
    const base = setExpanded(
      load(createFileTree(1), ROOT_PATH, [dir("docs")]),
      "docs",
      true,
    );
    const tree: FileTree = {
      ...base,
      directories: new Map(base.directories).set("docs", state),
    };
    mount(tree);

    expect(screen.getByRole("group").textContent).toBe(text);
  });
});
