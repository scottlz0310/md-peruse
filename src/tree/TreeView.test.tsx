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
import { type FocusRequest, TreeView } from "./TreeView";

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
  const opened: [string, boolean][] = [];
  const copied: [string, string][] = [];
  render(
    <TreeView
      onCopyPath={async (path, format) => {
        copied.push([path, format]);
      }}
      tree={tree}
      selectedPath={selectedPath}
      onToggle={(path, expanded) => toggled.push([path, expanded])}
      onOpen={(path, preview) => opened.push([path, preview])}
      focusRequest={null}
      onFocusRequestSettled={() => {}}
    />,
  );
  return { toggled, opened, copied };
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
    [" ", "empty", [["empty", true]], []],
    // `Enter` は固定タブ、`Space` はプレビュータブで開く（9.1）。
    ["Enter", "README.md", [], [["README.md", false]]],
    [" ", "README.md", [], [["README.md", true]]],
    // ファイルの `→` とルート直下の `←` は何もしない。
    ["ArrowRight", "README.md", [], []],
    ["ArrowLeft", "README.md", [], []],
  ])("%s を %s で押すと開閉または開く", (key, name, toggled, opened) => {
    const calls = mount(sampleTree());
    const target = item(name);
    target.focus();

    fireEvent.keyDown(target, { key });

    expect(calls.toggled).toEqual(toggled as [string, boolean][]);
    expect(calls.opened).toEqual(opened as [string, boolean][]);
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

  test("クリックでフォルダーを開閉し、ファイルをプレビューで開く", () => {
    const calls = mount(sampleTree());

    fireEvent.click(screen.getByText("docs"));
    fireEvent.click(screen.getByText("README.md"));

    expect(calls.toggled).toEqual([["docs", false]]);
    expect(calls.opened).toEqual([["README.md", true]]);
    expect(document.activeElement).toBe(item("README.md"));
  });

  test("ダブルクリックはファイルを固定で開き、フォルダーの開閉を繰り返さない", () => {
    const calls = mount(sampleTree());

    // ブラウザーは1回目のクリック（detail 1）の後に detail 2 のクリックを送る。
    for (const name of ["empty", "README.md"]) {
      fireEvent.click(screen.getByText(name), { detail: 1 });
      fireEvent.click(screen.getByText(name), { detail: 2 });
    }

    expect(calls.toggled).toEqual([["empty", true]]);
    expect(calls.opened).toEqual([
      ["README.md", true],
      ["README.md", false],
    ]);
  });

  test("畳まれて見えなくなった項目のフォーカスは、見えている親へ移す", () => {
    const tree = sampleTree();
    const { rerender } = render(
      <TreeView
        onCopyPath={async () => {}}
        tree={tree}
        selectedPath={null}
        onToggle={() => {}}
        onOpen={() => {}}
        focusRequest={null}
        onFocusRequestSettled={() => {}}
      />,
    );
    const guide = item("guide.md");
    guide.focus();

    rerender(
      <TreeView
        onCopyPath={async () => {}}
        tree={setExpanded(tree, "docs", false)}
        selectedPath={null}
        onToggle={() => {}}
        onOpen={() => {}}
        focusRequest={null}
        onFocusRequestSettled={() => {}}
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

describe("フォーカスの要求（10.1.1）", () => {
  /** 表示名から項目を引く。走査中のフォルダーは中の文言も名前に含むため、名前では引かない。 */
  const itemOf = (label: string) =>
    screen.getByText(label).closest('[role="treeitem"]');

  /** docs/ を展開して走査している途中のツリーと、その走査の成功・失敗。 */
  function scanningDocs() {
    const root = load(createFileTree(1), ROOT_PATH, [
      dir("docs"),
      dir("empty"),
      file("README.md"),
    ]);
    const started = beginScan(setExpanded(root, "docs", true), "docs");
    return {
      waiting: started.tree,
      arrived: applyScanResult(started.tree, started.token, {
        entries: [dir("docs/sub")],
      }) as FileTree,
      failed: applyScanResult(started.tree, started.token, {
        message: "アクセスできません",
      }) as FileTree,
    };
  }

  /** ツリーの外にフォーカスを移せるよう、ボタンを並べて描画する。 */
  function mountWith(tree: FileTree, request: FocusRequest | null) {
    const settled: FocusRequest[] = [];
    const view = (next: FileTree, nextRequest: FocusRequest | null) => (
      <>
        <button type="button">外</button>
        <TreeView
          onCopyPath={async () => {}}
          tree={next}
          selectedPath={null}
          onToggle={() => {}}
          onOpen={() => {}}
          focusRequest={nextRequest}
          onFocusRequestSettled={(done) => settled.push(done)}
        />
      </>
    );
    const { rerender } = render(view(tree, request));
    return {
      settled,
      update: (next: FileTree, nextRequest = request) =>
        rerender(view(next, nextRequest)),
    };
  }

  test.each([
    ["見えているフォルダーへ移す", "empty", "empty"],
    ["ルートは先頭の項目へ移す", ROOT_PATH, "docs"],
  ])("%s", (_, path, label) => {
    const request = { path };
    const { settled } = mountWith(sampleTree(), request);

    expect(document.activeElement).toBe(itemOf(label));
    expect((itemOf(label) as HTMLElement).tabIndex).toBe(0);
    expect(settled).toEqual([request]);
  });

  test("祖先の走査を待つ間は祖先に置き、見えたら移す", () => {
    const { waiting, arrived } = scanningDocs();
    const request = { path: "docs/sub" };
    const { settled, update } = mountWith(waiting, request);

    expect(document.activeElement).toBe(itemOf("docs"));
    expect(settled).toEqual([]);

    update(arrived);

    expect(document.activeElement).toBe(itemOf("sub"));
    expect(settled).toEqual([request]);
  });

  test("祖先の走査に失敗したら、その祖先で止める", () => {
    const { waiting, failed } = scanningDocs();
    const request = { path: "docs/sub" };
    const { settled, update } = mountWith(waiting, request);

    update(failed);

    expect(document.activeElement).toBe(itemOf("docs"));
    expect(settled).toEqual([request]);
  });

  test("待つ間にツリーを操作したら取り下げ、走査が終わってもフォーカスを奪わない", () => {
    const { waiting, arrived } = scanningDocs();
    const request = { path: "docs/sub" };
    const { settled, update } = mountWith(waiting, request);

    fireEvent.keyDown(itemOf("docs") as Element, { key: "ArrowDown" });
    expect(settled).toEqual([request]);
    // 呼び出し側が要求を片付ける前に描画し直しても、処理し終えた要求は扱わない。
    update(arrived);

    expect(document.activeElement).toBe(itemOf("empty"));
  });

  test("待つ間にフォーカスがツリーの外へ出たら取り下げる", () => {
    const { waiting, arrived } = scanningDocs();
    const request = { path: "docs/sub" };
    const { settled, update } = mountWith(waiting, request);

    const outside = screen.getByRole("button", { name: "外" });
    outside.focus();
    update(arrived);

    expect(document.activeElement).toBe(outside);
    expect(settled).toEqual([request]);
  });

  test("同じフォルダーを選び直すと、もう一度移す", () => {
    const first = { path: "empty" };
    const { settled, update } = mountWith(sampleTree(), first);
    fireEvent.keyDown(itemOf("empty") as Element, { key: "End" });
    expect(document.activeElement).toBe(itemOf("README.md"));

    const second = { path: "empty" };
    update(sampleTree(), second);

    expect(document.activeElement).toBe(itemOf("empty"));
    expect(settled).toEqual([first, second]);
  });
});

describe("TreeView: パスコピー", () => {
  test.each(["README.md", "empty", "guide.md"])(
    "右クリックした%sをコピーし、文書と展開状態を変えない",
    (name) => {
      const calls = mount(sampleTree(), "docs/guide.md");
      const target = item(name);
      fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      expect(calls.opened).toEqual([]);
      expect(calls.toggled).toEqual([]);
      fireEvent.click(
        screen.getByRole("menuitem", { name: "絶対パスをコピー" }),
      );
      expect(calls.copied).toEqual([
        [name === "guide.md" ? "docs/guide.md" : name, "absolute"],
      ]);
      expect(document.activeElement).toBe(target);
    },
  );
  test.each([{ key: "ContextMenu" }, { key: "F10", shiftKey: true }])(
    "キーボードで開き、相対形式を選択・Escで戻る %j",
    (key) => {
      const calls = mount(sampleTree());
      const target = item("README.md");
      fireEvent.keyDown(target, key);
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", { name: "絶対パスをコピー" }),
      );
      fireEvent.keyDown(document.activeElement as HTMLElement, {
        key: "ArrowDown",
      });
      expect(document.activeElement).toBe(
        screen.getByRole("menuitem", {
          name: "ワークスペース相対パスをコピー",
        }),
      );
      fireEvent.click(document.activeElement as HTMLElement);
      expect(calls.copied).toEqual([["README.md", "relative"]]);
      fireEvent.keyDown(target, key);
      fireEvent.keyDown(document.activeElement as HTMLElement, {
        key: "Escape",
      });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(document.activeElement).toBe(target);
    },
  );
});

test("パスコピーメニューは親の再描画後も相対形式のフォーカスを保つ", () => {
  const copied: [string, string][] = [];
  const props = {
    tree: sampleTree(),
    selectedPath: "docs/guide.md",
    onToggle: () => {},
    onOpen: () => {},
    focusRequest: null,
    onFocusRequestSettled: () => {},
    onCopyPath: async (path: string, format: "absolute" | "relative") => {
      copied.push([path, format]);
    },
  };
  const view = render(<TreeView {...props} />);
  fireEvent.keyDown(item("README.md"), { key: "F10", shiftKey: true });
  fireEvent.keyDown(
    screen.getByRole("menuitem", { name: "絶対パスをコピー" }),
    { key: "ArrowDown" },
  );
  const relative = screen.getByRole("menuitem", {
    name: "ワークスペース相対パスをコピー",
  });
  expect(document.activeElement).toBe(relative);
  view.rerender(<TreeView {...props} />);
  expect(document.activeElement).toBe(relative);
  fireEvent.click(relative);
  expect(copied).toEqual([["README.md", "relative"]]);
});
