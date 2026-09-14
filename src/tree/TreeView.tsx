import { type KeyboardEvent, useRef, useState } from "react";
import {
  type FileTree,
  isExpandable,
  ROOT_PATH,
  type VisibleNode,
  visibleNodes,
} from "../state/file-tree";
import type { FileNode } from "../types/generated/FileNode";

type Props = {
  tree: FileTree;
  /** 表示中の文書のパス。ツリーの選択として示す。 */
  selectedPath: string | null;
  /** フォルダーを展開する・畳む。展開したときの走査は呼び出し側が行う。 */
  onToggle: (path: string, expanded: boolean) => void;
  /** Markdownファイルを開く。 */
  onOpen: (path: string) => void;
};

/**
 * ワークスペースのファイルツリー（design-decisions.md 6.2、10章）。
 *
 * WAI-ARIAのtreeパターンに従い、フォーカスは1つの項目だけが持つ（roving tabindex）。
 * 矢印で移動し、`→` で展開または最初の子へ、`←` で畳むか親へ移る。`Home` / `End` で先頭と
 * 末尾へ、`Enter` でフォルダーの開閉とファイルを開く操作を行う。
 */
export function TreeView({ tree, selectedPath, onToggle, onOpen }: Props) {
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLLIElement>());
  const visible = visibleNodes(tree);
  const current = currentFocus(visible, focusedPath, selectedPath);

  function focus(path: string) {
    setFocusedPath(path);
    items.current.get(path)?.focus();
  }

  function activate(node: FileNode) {
    if (isExpandable(node)) {
      onToggle(node.path, !tree.expanded.has(node.path));
    } else if (node.kind === "markdown") {
      onOpen(node.path);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    // キーを受けた項目を起点にする。フォーカスの記録（state）は描画を経て更新されるため、
    // フォーカスの移動と同じ描画のうちに届いたキーでは古い位置を指しうる。
    const target =
      event.target instanceof Element
        ? event.target.closest('[role="treeitem"]')
        : null;
    const active =
      visible.find(({ node }) => items.current.get(node.path) === target) ??
      current;
    if (active === undefined) return;
    const index = visible.indexOf(active);
    const { node, parent } = active;
    const expandable = isExpandable(node);
    const expanded = tree.expanded.has(node.path);
    switch (event.key) {
      case "ArrowDown": {
        const next = visible[index + 1];
        if (next) focus(next.node.path);
        break;
      }
      case "ArrowUp": {
        const previous = visible[index - 1];
        if (previous) focus(previous.node.path);
        break;
      }
      case "Home": {
        const first = visible[0];
        if (first) focus(first.node.path);
        break;
      }
      case "End": {
        const last = visible[visible.length - 1];
        if (last) focus(last.node.path);
        break;
      }
      case "ArrowRight":
        if (!expandable) break;
        if (!expanded) {
          onToggle(node.path, true);
        } else {
          const child = visible[index + 1];
          if (child?.parent === node.path) focus(child.node.path);
        }
        break;
      case "ArrowLeft":
        if (expandable && expanded) onToggle(node.path, false);
        else if (parent !== ROOT_PATH) focus(parent);
        break;
      case "Enter":
        activate(node);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const register = (path: string) => (element: HTMLLIElement | null) => {
    if (element) items.current.set(path, element);
    else items.current.delete(path);
  };

  function renderDirectory(path: string, level: number) {
    const state = tree.directories.get(path);
    if (state === undefined) return null;
    if (state.status === "loading") {
      return (
        <li role="none" className="tree-status">
          読み込み中…
        </li>
      );
    }
    if (state.status === "failed") {
      return (
        <li role="none" className="tree-status tree-error">
          {state.message}
        </li>
      );
    }
    return state.entries.map((node) => {
      const expandable = isExpandable(node);
      const expanded = expandable && tree.expanded.has(node.path);
      return (
        <li
          key={node.path}
          ref={register(node.path)}
          role="treeitem"
          aria-level={level}
          aria-expanded={expandable ? expanded : undefined}
          aria-selected={node.path === selectedPath}
          tabIndex={node.path === current?.node.path ? 0 : -1}
          onFocus={(event) => {
            // 子孫の項目のフォーカスが親の `li` まで伝わるため、自分自身のときだけ扱う。
            if (event.target === event.currentTarget) setFocusedPath(node.path);
          }}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: 行はマウス操作の受け口であり、操作対象は `treeitem` である。キー操作は `role="tree"` の要素がまとめて受ける（WAI-ARIAのtreeパターン）。 */}
          <div
            className="tree-row"
            onClick={() => {
              focus(node.path);
              activate(node);
            }}
          >
            <span className="tree-toggle" aria-hidden="true">
              {expandable ? (expanded ? "▾" : "▸") : ""}
            </span>
            <span className="tree-label">{node.name}</span>
          </div>
          {expanded && (
            // biome-ignore lint/a11y/useSemanticElements: treeの子の集まりは `role="group"` で示す（WAI-ARIAのtreeパターン）。`fieldset` はフォームの区切りであり意味が異なる。
            <ul role="group">{renderDirectory(node.path, level + 1)}</ul>
          )}
        </li>
      );
    });
  }

  return (
    <ul
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: 項目の並びを `ul` と `li` で持ち、`tree` / `treeitem` の役割を与える（WAI-ARIAのtreeパターン）。
      role="tree"
      aria-label="ファイル"
      className="tree"
      onKeyDown={onKeyDown}
    >
      {renderDirectory(ROOT_PATH, 1)}
    </ul>
  );
}

/**
 * フォーカスを持たせる項目を決める。
 *
 * 利用者が動かした位置を優先する。その項目が畳まれて見えなくなったときは、見えている
 * 最も近い祖先へ移す。まだ動かしていなければ表示中の文書、なければ先頭とする。
 */
function currentFocus(
  visible: readonly VisibleNode[],
  focusedPath: string | null,
  selectedPath: string | null,
): VisibleNode | undefined {
  const byPath = (path: string | null) =>
    path === null ? undefined : visible.find(({ node }) => node.path === path);
  if (focusedPath !== null) {
    for (let path = focusedPath; path !== ROOT_PATH; path = parentOf(path)) {
      const found = byPath(path);
      if (found) return found;
    }
  }
  return byPath(selectedPath) ?? visible[0];
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? ROOT_PATH : path.slice(0, index);
}
