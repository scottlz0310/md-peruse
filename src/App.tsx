import type { UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import {
  getUiSettings,
  issueImageResources,
  readFile,
  scanDirectory,
  updateUiSettings,
} from "./ipc/commands";
import { onWorkspaceOpened } from "./ipc/events";
import { SidebarLayout } from "./layout/SidebarLayout";
import type { LinkTarget } from "./markdown/link-target";
import { DocumentFind } from "./preview/DocumentFind";
import { LINK_REJECTION_MESSAGES } from "./preview/link-click";
import { MarkdownDocument } from "./preview/MarkdownDocument";
import { currentEntry, updateCurrentScroll } from "./state/doc-history";
import {
  completeLoad,
  failLoad,
  type LoadIntent,
  navigateWithin,
  startLoad,
  stepHistory,
  type ViewTarget,
} from "./state/document-tab";
import {
  applyScanResult,
  beginScan,
  createFileTree,
  type FileTree,
  needsScan,
  ROOT_PATH,
  setExpanded,
} from "./state/file-tree";
import {
  activateTab,
  activeTab,
  adjacentTabId,
  closeTab,
  EMPTY_TAB_SET,
  findTabByPath,
  type OpenTab,
  openTab,
  pinTab,
  type TabSet,
  updateTab,
} from "./state/tab-set";
import { TabBar, tabElementId } from "./tabs/TabBar";
import { TreeView } from "./tree/TreeView";
import type { FileContent } from "./types/generated/FileContent";
import type { IpcError } from "./types/generated/IpcError";
import type { UiSettings } from "./types/generated/UiSettings";
import type { WorkspaceOpenedEvent } from "./types/generated/WorkspaceOpenedEvent";

/** アクティブタブに表示している本文。本文DOMはアクティブタブだけが持つ（9.1）。 */
type Shown = {
  tabId: string;
  content: FileContent;
  view: ViewTarget;
};

export default function App() {
  // 設定を読むまで描画しない。既定値で描いてから切り替えると、幅が一瞬変わって見える。
  const [ui, setUi] = useState<UiSettings | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceOpenedEvent | null>(null);
  const [tree, setTree] = useState<FileTree>(() => createFileTree(0));
  const [tabs, setTabs] = useState<TabSet>(EMPTY_TAB_SET);
  const [shown, setShown] = useState<Shown | null>(null);
  // IPCの失敗は `IpcError` の文言を、Frontendで判定した失敗（解決できないリンク）は
  // Frontendの文言をそのまま表示する。
  const [error, setError] = useState<string | null>(null);
  // 文書の読込で監視スコープを添えるために持つ。
  const scopeRef = useRef<string | null>(null);
  // 走査と読込の応答は描画を待たずに最新の状態と照合するため、refにも持つ（5.3、6.5）。
  const treeRef = useRef<FileTree>(tree);
  const tabsRef = useRef<TabSet>(tabs);
  // プレビュー領域のDOMがどのタブの本文を表示しているか。タブを切り替えた直後の再描画前は、
  // アクティブタブと表示中の本文が一致しない。スクロール位置の読み取りはこちらで判定する。
  const shownRef = useRef<Shown | null>(shown);
  const tabSeqRef = useRef(0);
  const documentRef = useRef<HTMLElement>(null);
  // 本文のスクロール位置はプレビュー領域が持つ。ウィンドウ全体はスクロールしない。
  const previewRef = useRef<HTMLElement>(null);

  useEffect(() => {
    getUiSettings().then(setUi, (reason: unknown) =>
      setStartupError(String(reason)),
    );
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 呼び出す関数はrefだけを読み書きし、描画ごとの値に依存しない。購読は1度でよい。
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    onWorkspaceOpened((opened) => {
      scopeRef.current = opened.scopeId;
      setWorkspace(opened);
      updateShown(null);
      setError(null);
      // ワークスペースを切り替えるとタブも破棄する（6.1）。
      updateTabs(EMPTY_TAB_SET);
      // ワークスペースを開くたびに世代を進めた新しいツリーへ替える（5.3）。
      updateTree(createFileTree(treeRef.current.workspaceGeneration + 1));
      scan(ROOT_PATH);
    }).then((stop) => {
      // StrictModeでは購読の完了前に片付けが走る。そのときは直ちに解除する。
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function updateTree(next: FileTree) {
    treeRef.current = next;
    setTree(next);
  }

  function updateTabs(next: TabSet) {
    tabsRef.current = next;
    setTabs(next);
  }

  function updateShown(next: Shown | null) {
    shownRef.current = next;
    setShown(next);
  }

  /** フォルダーを走査し、陳腐化していなければ結果をツリーへ反映する。 */
  function scan(path: string) {
    const started = beginScan(treeRef.current, path);
    updateTree(started.tree);
    scanDirectory(path).then(
      (result) => {
        const next = applyScanResult(treeRef.current, started.token, result);
        if (next) updateTree(next);
      },
      (reason: IpcError) => {
        const next = applyScanResult(treeRef.current, started.token, {
          message: reason.message,
        });
        if (next) updateTree(next);
      },
    );
  }

  function toggleDirectory(path: string, expanded: boolean) {
    updateTree(setExpanded(treeRef.current, path, expanded));
    if (expanded && needsScan(treeRef.current, path)) scan(path);
  }

  function scrollTop() {
    return previewRef.current?.scrollTop ?? 0;
  }

  function findTab(tabId: string): OpenTab | undefined {
    return tabsRef.current.tabs.find((tab) => tab.tabId === tabId);
  }

  function isActive(tabId: string) {
    return tabsRef.current.activeTabId === tabId;
  }

  /** アクティブタブを離れる前に、本文のスクロール位置を履歴へ残す（9.3）。 */
  function saveActiveScroll() {
    const active = activeTab(tabsRef.current);
    if (!active || shownRef.current?.tabId !== active.tabId) return;
    const top = scrollTop();
    updateTabs(
      updateTab(tabsRef.current, active.tabId, (tab) => ({
        ...tab,
        history: updateCurrentScroll(tab.history, top),
      })),
    );
  }

  /**
   * タブへ文書を読み込む。読み込めなければ理由を示し、表示中の文書は保つ（7.2の
   * 「存在しない相対リンクは遷移せず、その場で理由を表示する」）。最初の読込に失敗した
   * タブは閉じる。
   */
  function load(
    tabId: string,
    path: string,
    intent: LoadIntent,
    // 表示中のエラーを成功時に消さない。閉じたタブの失敗理由を、代わりに表示する
    // タブの読込で消さないために使う。
    keepError = false,
  ) {
    const scopeId = scopeRef.current;
    const tab = findTab(tabId);
    if (scopeId === null || tab === undefined) return;
    const started = startLoad(tab, { tabId, scopeId }, path);
    updateTabs(
      updateTab(tabsRef.current, tabId, (current) => ({
        ...current,
        ...started.tab,
        pendingPath: path,
      })),
    );
    readFile(path).then(
      (content) => {
        const current = findTab(tabId);
        if (current === undefined) return;
        // プレビュー領域がこのタブの本文を表示しているときだけ、いまのスクロール位置を
        // 読む。切り替えた直後や離れたタブでは、表示中なのは別のタブの本文である。
        const leftAt =
          shownRef.current?.tabId === tabId
            ? scrollTop()
            : (currentEntry(current.history)?.scrollTop ?? 0);
        const done = completeLoad(current, started.token, intent, leftAt);
        if (done === undefined) return;
        updateTabs(
          updateTab(tabsRef.current, tabId, (latest) => ({
            ...latest,
            ...done.tab,
            pendingPath: null,
          })),
        );
        if (isActive(tabId)) {
          updateShown({ tabId, content, view: done.view });
          if (!keepError) setError(null);
        }
      },
      (reason: IpcError) => {
        const current = findTab(tabId);
        if (current === undefined) return;
        const failed = failLoad(current, started.token, intent);
        if (failed === undefined) return;
        const wasActive = isActive(tabId);
        if (failed.tab === null) {
          updateTabs(closeTab(tabsRef.current, tabId, Date.now()));
          if (wasActive) showActive(true);
        } else {
          const next = failed.tab;
          updateTabs(
            updateTab(tabsRef.current, tabId, (latest) => ({
              ...latest,
              ...next,
              pendingPath: null,
            })),
          );
        }
        if (wasActive) setError(reason.message);
      },
    );
  }

  /**
   * アクティブタブの現在の文書を表示する。非アクティブタブは本文を持たないため、切り替えの
   * たびに読み直し、離れたときのスクロール位置へ戻す（9.1、9.3）。
   */
  function showActive(keepError = false) {
    const active = activeTab(tabsRef.current);
    if (!active) {
      updateShown(null);
      return;
    }
    const entry = currentEntry(active.history);
    // 最初の読込を待っているタブは、その完了で表示される。
    if (entry === undefined) return;
    load(
      active.tabId,
      entry.path,
      { kind: "history", index: active.history.index },
      keepError,
    );
  }

  function nextTabId() {
    tabSeqRef.current += 1;
    return `tab-${tabSeqRef.current}`;
  }

  /** ツリーから文書を開く。シングルクリックはプレビュー、`Enter` とダブルクリックは固定。 */
  function openFromTree(path: string, preview: boolean) {
    const scopeId = scopeRef.current;
    if (scopeId === null) return;
    const before = tabsRef.current.activeTabId;
    saveActiveScroll();
    const result = openTab(tabsRef.current, {
      path,
      preview,
      now: Date.now(),
      fresh: { tabId: nextTabId(), scopeId },
    });
    updateTabs(result.set);
    setError(null);
    if (result.opened) {
      load(result.opened.tabId, path, { kind: "push", path, anchor: null });
    } else if (result.set.activeTabId !== before) {
      showActive();
    }
  }

  function activate(tabId: string) {
    if (isActive(tabId)) return;
    saveActiveScroll();
    updateTabs(activateTab(tabsRef.current, tabId, Date.now()));
    setError(null);
    showActive();
  }

  function close(tabId: string) {
    const wasActive = isActive(tabId);
    updateTabs(closeTab(tabsRef.current, tabId, Date.now()));
    if (wasActive) {
      setError(null);
      showActive();
    }
  }

  /** タブの中で表示を変える操作は、プレビュータブを固定する。 */
  function pinActive() {
    const active = activeTab(tabsRef.current);
    if (active) updateTabs(pinTab(tabsRef.current, active.tabId));
  }

  /** 本文のリンクで別の文書を開く。既に別のタブで開いていればそのタブへ切り替える（9.3）。 */
  function openLink(path: string, anchor: string | null) {
    const active = activeTab(tabsRef.current);
    if (!active) return;
    const shownNow = shownRef.current;
    if (shownNow?.tabId === active.tabId && shownNow.content.path === path) {
      moveWithin(anchor);
      return;
    }
    const other = findTabByPath(tabsRef.current, path);
    if (other && anchor === null) {
      activate(other.tabId);
      return;
    }
    if (other) {
      // 見出しを指すリンクは、切り替えた先のタブで読み直してから見出しへ移る。表示を変える
      // 操作なので、そのタブを固定する。
      saveActiveScroll();
      updateTabs(
        pinTab(
          activateTab(tabsRef.current, other.tabId, Date.now()),
          other.tabId,
        ),
      );
      setError(null);
      load(other.tabId, path, { kind: "push", path, anchor });
      return;
    }
    pinActive();
    load(active.tabId, path, { kind: "push", path, anchor });
  }

  function moveWithin(anchor: string | null) {
    const active = activeTab(tabsRef.current);
    const shown = shownRef.current;
    if (!active || shown?.tabId !== active.tabId) return;
    const moved = navigateWithin(active, anchor, scrollTop());
    updateTabs(
      pinTab(
        updateTab(tabsRef.current, active.tabId, (tab) => ({
          ...tab,
          ...moved.tab,
        })),
        active.tabId,
      ),
    );
    updateShown({ ...shown, view: moved.view });
    setError(null);
  }

  function step(direction: "back" | "forward") {
    const active = activeTab(tabsRef.current);
    const shown = shownRef.current;
    if (!active || shown?.tabId !== active.tabId) return;
    const result = stepHistory(active, direction, scrollTop());
    if (result === undefined) return;
    if (result.kind === "load") {
      load(active.tabId, result.path, result.intent);
      return;
    }
    const next = result.tab;
    updateTabs(
      updateTab(tabsRef.current, active.tabId, (tab) => ({ ...tab, ...next })),
    );
    updateShown({ ...shown, view: result.view });
    setError(null);
  }

  // WebViewの履歴は空のまま保ち、`Alt+←` とマウスのサイドボタンを自前の履歴へつなぐ（9.3）。
  // タブの移動（`Ctrl+Tab` / `Ctrl+Shift+Tab`）もメニュー項目を持たずWebView内で扱う（10.1）。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.key !== "Tab") return;
        event.preventDefault();
        const next = adjacentTabId(
          tabsRef.current,
          event.shiftKey ? "previous" : "next",
        );
        if (next) activate(next);
        return;
      }
      if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step("back");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step("forward");
      }
    }
    function onAuxClick(event: MouseEvent) {
      if (event.button === 3) {
        event.preventDefault();
        step("back");
      } else if (event.button === 4) {
        event.preventDefault();
        step("forward");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("auxclick", onAuxClick);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("auxclick", onAuxClick);
    };
  });

  function navigate(target: LinkTarget) {
    switch (target.kind) {
      case "anchor":
        moveWithin(target.elementId);
        return;
      case "document":
        openLink(target.path, target.elementId);
        return;
      case "external":
        // opener の権限は `http` と `https` に限ってある（5.5）。
        openUrl(target.url).catch((reason: unknown) => {
          setError(String(reason));
        });
        return;
      case "rejected":
        setError(LINK_REJECTION_MESSAGES[target.reason]);
        return;
    }
  }

  if (startupError !== null) {
    return (
      <main className="app">
        <p role="alert">{startupError}</p>
      </main>
    );
  }
  if (ui === null) return null;

  if (!workspace) {
    return (
      <main className="app">
        <h1>md-peruse</h1>
        <p>メニューの「ファイル」から「フォルダーを開く」を選んでください。</p>
      </main>
    );
  }

  const active = activeTab(tabs);
  const visible =
    shown !== null && shown.tabId === active?.tabId ? shown : null;

  return (
    <SidebarLayout
      savedWidth={ui.sidebarWidth}
      sidebarVisible={ui.sidebarVisible}
      onWidthCommit={(sidebarWidth) => {
        updateUiSettings({ sidebarWidth }).catch((reason: unknown) =>
          setError(String(reason)),
        );
      }}
      previewRef={previewRef}
      sidebar={
        <>
          <h1>{workspace.label}</h1>
          <TreeView
            tree={tree}
            selectedPath={active?.path ?? null}
            onToggle={toggleDirectory}
            onOpen={openFromTree}
          />
        </>
      }
      previewHeader={
        tabs.tabs.length > 0 && (
          <TabBar
            set={tabs}
            onActivate={activate}
            onClose={close}
            onPin={(tabId) => updateTabs(pinTab(tabsRef.current, tabId))}
          />
        )
      }
      previewLabelledBy={active ? tabElementId(active.tabId) : undefined}
    >
      {error && <p role="alert">{error}</p>}
      {visible && (
        <>
          <DocumentFind root={documentRef} />
          <MarkdownDocument
            ref={documentRef}
            text={visible.content.text}
            path={visible.content.path}
            view={visible.view}
            onNavigate={navigate}
            issueImages={issueImageResources}
            scroller={previewRef}
          />
        </>
      )}
    </SidebarLayout>
  );
}
