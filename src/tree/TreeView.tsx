import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useMessages } from "../i18n/LanguageContext";
import {
  type FileTree,
  isExpandable,
  ROOT_PATH,
  revealFocus,
  type VisibleNode,
  visibleNodes,
} from "../state/file-tree";
import type { FileNode } from "../types/generated/FileNode";

/**
 * 外からフォーカスを移してほしいフォルダー（パンくず。10.1.1）。ルートは先頭の項目を
 * 指す。同じパスを選び直しても別の要求として扱うため、要求ごとに新しいオブジェクトを作る。
 */
export type FocusRequest = { readonly path: string };

type Props = {
  tree: FileTree;
  /** 表示中の文書のパス。ツリーの選択として示す。 */
  selectedPath: string | null;
  /** フォルダーを展開する・畳む。展開したときの走査は呼び出し側が行う。 */
  onToggle: (path: string, expanded: boolean) => void;
  /**
   * Markdownファイルを開く。`preview` はプレビュータブで開くか（9.1）。シングルクリックと
   * `Space` はプレビュー、ダブルクリックと `Enter` は固定タブで開く。
   */
  onOpen: (path: string, preview: boolean) => void;
  /** 処理していないフォーカスの要求。 */
  focusRequest: FocusRequest | null;
  /** 要求を処理し終えたか、取り下げた。呼び出し側は要求を片付ける。 */
  onFocusRequestSettled: (request: FocusRequest) => void;
};

/**
 * ワークスペースのファイルツリー（design-decisions.md 6.2、10章）。
 *
 * WAI-ARIAのtreeパターンに従い、フォーカスは1つの項目だけが持つ（roving tabindex）。
 * 矢印で移動し、`→` で展開または最初の子へ、`←` で畳むか親へ移る。`Home` / `End` で先頭と
 * 末尾へ、`Enter` と `Space` でフォルダーの開閉とファイルを開く操作を行う。
 *
 * フォーカスの要求は、対象の項目が見えるまで待つ。祖先の走査を待つ間は、見えている最も
 * 近い祖先にフォーカスを置く。待つ間に利用者がツリーを操作するか、フォーカスがツリーの外へ
 * 出たら取り下げる。走査が後から終わっても、利用者の操作からフォーカスを奪わないためである。
 */
export function TreeView({
  tree,
  selectedPath,
  onToggle,
  onOpen,
  focusRequest,
  onFocusRequestSettled,
}: Props) {
  const messages = useMessages();
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLLIElement>());
  const root = useRef<HTMLUListElement>(null);
  // 要求を待つ間にフォーカスを置いた項目。処理し終えた要求は再び扱わない。
  const placed = useRef<{ request: FocusRequest; path: string } | null>(null);
  const settled = useRef<FocusRequest | null>(null);
  const visible = visibleNodes(tree);
  const current = currentFocus(visible, focusedPath, selectedPath);

  function focus(path: string) {
    setFocusedPath(path);
    items.current.get(path)?.focus();
  }

  function settle(request: FocusRequest) {
    placed.current = null;
    settled.current = request;
    onFocusRequestSettled(request);
  }

  /** 待っている要求を、利用者の操作で取り下げる。 */
  function cancelFocusRequest() {
    if (focusRequest !== null && focusRequest !== settled.current) {
      settle(focusRequest);
    }
  }

  // 走査の応答でツリーが変わるたびに、要求の置き場所を見直す。
  useEffect(() => {
    if (focusRequest === null || focusRequest === settled.current) return;
    const waiting =
      placed.current?.request === focusRequest ? placed.current.path : null;
    if (waiting !== null && !root.current?.contains(document.activeElement)) {
      settle(focusRequest);
      return;
    }
    const target = revealFocus(tree, focusRequest.path);
    if (target.path !== null && target.path !== waiting) focus(target.path);
    placed.current =
      target.path === null
        ? null
        : { request: focusRequest, path: target.path };
    if (target.done) settle(focusRequest);
  });

  function activate(node: FileNode, preview: boolean) {
    if (isExpandable(node)) {
      onToggle(node.path, !tree.expanded.has(node.path));
    } else if (node.kind === "markdown") {
      onOpen(node.path, preview);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    cancelFocusRequest();
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
        activate(node, false);
        break;
      case " ":
        activate(node, true);
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
          {messages.treeLoading}
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
            onClick={(event) => {
              cancelFocusRequest();
              focus(node.path);
              // ダブルクリックは1回目のクリックでプレビューとして開いた後に届く。
              // フォルダーでは開閉を2回繰り返さず、ファイルでは固定する。
              if (event.detail >= 2) {
                if (node.kind === "markdown") onOpen(node.path, false);
                return;
              }
              activate(node, true);
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
      ref={root}
      // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: 項目の並びを `ul` と `li` で持ち、`tree` / `treeitem` の役割を与える（WAI-ARIAのtreeパターン）。
      role="tree"
      aria-label={messages.treeLabel}
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
