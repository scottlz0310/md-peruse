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
import {
  completeLoad,
  type DocumentTab,
  failLoad,
  type LoadIntent,
  navigateWithin,
  startLoad,
  stepHistory,
  type ViewTarget,
} from "./state/document-tab";
import type { FileContent } from "./types/generated/FileContent";
import type { FileNode } from "./types/generated/FileNode";
import type { IpcError } from "./types/generated/IpcError";
import type { UiSettings } from "./types/generated/UiSettings";
import type { WorkspaceOpenedEvent } from "./types/generated/WorkspaceOpenedEvent";

// サイドバーの一覧は仮であり、ツリー（6.2）の実装で置き換える。タブバーはタブ（9.1）の
// 実装で加える。

type Shown = {
  content: FileContent;
  view: ViewTarget;
};

export default function App() {
  // 設定を読むまで描画しない。既定値で描いてから切り替えると、幅が一瞬変わって見える。
  const [ui, setUi] = useState<UiSettings | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceOpenedEvent | null>(null);
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [shown, setShown] = useState<Shown | null>(null);
  // IPCの失敗は `IpcError` の文言を、Frontendで判定した失敗（解決できないリンク）は
  // Frontendの文言をそのまま表示する。
  const [error, setError] = useState<string | null>(null);
  // 応答が届いた時点のスコープと照合し、切り替え前の要求の応答を捨てる（5.3）。
  const scopeRef = useRef<string | null>(null);
  // 非同期の応答は描画を待たずに最新のタブと照合するため、タブはrefに持つ。
  const tabRef = useRef<DocumentTab | null>(null);
  const tabSeqRef = useRef(0);
  const documentRef = useRef<HTMLElement>(null);
  // 本文のスクロール位置はプレビュー領域が持つ。ウィンドウ全体はスクロールしない。
  const previewRef = useRef<HTMLElement>(null);

  useEffect(() => {
    getUiSettings().then(setUi, (reason: unknown) =>
      setStartupError(String(reason)),
    );
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    onWorkspaceOpened((opened) => {
      scopeRef.current = opened.scopeId;
      tabRef.current = null;
      setWorkspace(opened);
      setEntries([]);
      setShown(null);
      setError(null);
      scanDirectory("").then(
        (result) => {
          if (scopeRef.current === opened.scopeId) setEntries(result.entries);
        },
        (reason: IpcError) => {
          if (scopeRef.current === opened.scopeId) setError(reason.message);
        },
      );
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

  /**
   * 文書を読み込んで表示する。読み込めなければ理由を示し、表示中の文書は保つ（7.2の
   * 「存在しない相対リンクは遷移せず、その場で理由を表示する」）。
   */
  function load(path: string, intent: LoadIntent) {
    const scopeId = scopeRef.current;
    if (scopeId === null) return;
    tabSeqRef.current += 1;
    const started = startLoad(
      tabRef.current,
      { tabId: `tab-${tabSeqRef.current}`, scopeId },
      path,
    );
    tabRef.current = started.tab;
    readFile(path).then(
      (content) => {
        const tab = tabRef.current;
        if (tab === null) return;
        const done = completeLoad(tab, started.token, intent, scrollTop());
        if (done === undefined) return;
        tabRef.current = done.tab;
        setShown({ content, view: done.view });
        setError(null);
      },
      (reason: IpcError) => {
        const tab = tabRef.current;
        if (tab === null) return;
        const failed = failLoad(tab, started.token, intent);
        if (failed === undefined) return;
        tabRef.current = failed.tab;
        setError(reason.message);
      },
    );
  }

  function scrollTop() {
    return previewRef.current?.scrollTop ?? 0;
  }

  function open(path: string, anchor: string | null) {
    const tab = tabRef.current;
    if (tab !== null && shown !== null && shown.content.path === path) {
      moveWithin(tab, anchor);
      return;
    }
    load(path, { kind: "push", path, anchor });
  }

  function moveWithin(tab: DocumentTab, anchor: string | null) {
    if (shown === null) return;
    const moved = navigateWithin(tab, anchor, scrollTop());
    tabRef.current = moved.tab;
    setShown({ content: shown.content, view: moved.view });
    setError(null);
  }

  function step(direction: "back" | "forward") {
    const tab = tabRef.current;
    if (tab === null || shown === null) return;
    const result = stepHistory(tab, direction, scrollTop());
    if (result === undefined) return;
    if (result.kind === "load") {
      load(result.path, result.intent);
      return;
    }
    tabRef.current = result.tab;
    setShown({ content: shown.content, view: result.view });
    setError(null);
  }

  // WebViewの履歴は空のまま保ち、`Alt+←` とマウスのサイドボタンを自前の履歴へつなぐ（9.3）。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
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
      case "anchor": {
        const tab = tabRef.current;
        if (tab !== null) moveWithin(tab, target.elementId);
        return;
      }
      case "document":
        open(target.path, target.elementId);
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
          <ul>
            {entries.map((node) => (
              <li key={node.path}>
                {node.kind === "markdown" ? (
                  <button type="button" onClick={() => open(node.path, null)}>
                    {node.name}
                  </button>
                ) : (
                  node.name
                )}
              </li>
            ))}
          </ul>
        </>
      }
    >
      {error && <p role="alert">{error}</p>}
      {shown && (
        <>
          <DocumentFind root={documentRef} />
          <MarkdownDocument
            ref={documentRef}
            text={shown.content.text}
            path={shown.content.path}
            view={shown.view}
            onNavigate={navigate}
            issueImages={issueImageResources}
            scroller={previewRef}
          />
        </>
      )}
    </SidebarLayout>
  );
}
