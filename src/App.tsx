import type { UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { issueImageResources, readFile, scanDirectory } from "./ipc/commands";
import { onWorkspaceOpened } from "./ipc/events";
import { LINK_REJECTION_MESSAGES } from "./preview/link-click";
import {
  MarkdownDocument,
  type NavigationTarget,
} from "./preview/MarkdownDocument";
import type { FileContent } from "./types/generated/FileContent";
import type { FileNode } from "./types/generated/FileNode";
import type { IpcError } from "./types/generated/IpcError";
import type { WorkspaceOpenedEvent } from "./types/generated/WorkspaceOpenedEvent";

// Rust側のcommandとeventを実際に通すための仮の画面である（dev-flow 第6章）。
// 一覧はツリー（6.2）の実装で、文書の表示はタブ（9.1）の実装で置き換える。

type OpenDocument = {
  content: FileContent;
  /** 描画の完了後に移動する見出しのID。 */
  anchor: string | null;
};

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceOpenedEvent | null>(null);
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [document, setDocument] = useState<OpenDocument | null>(null);
  // IPCの失敗は `IpcError` の文言を、Frontendで判定した失敗（解決できないリンク）は
  // Frontendの文言をそのまま表示する。
  const [error, setError] = useState<string | null>(null);
  // 応答が届いた時点のスコープと照合し、切り替え前の要求の応答を捨てる（5.3）。
  const scopeRef = useRef<string | null>(null);
  // 後から始めた読込を優先する。先に始めた読込が後から完了しても、新しい文書を
  // 古い文書で上書きしない（6.5の読込世代を、タブを持つまで画面全体で1つ持つ）。
  const loadRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    onWorkspaceOpened((opened) => {
      scopeRef.current = opened.scopeId;
      loadRef.current += 1;
      setWorkspace(opened);
      setEntries([]);
      setDocument(null);
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
  function open(path: string, anchor: string | null) {
    const scopeId = scopeRef.current;
    loadRef.current += 1;
    const load = loadRef.current;
    const isCurrent = () =>
      scopeRef.current === scopeId && loadRef.current === load;
    readFile(path).then(
      (content) => {
        if (!isCurrent()) return;
        setDocument({ content, anchor });
        setError(null);
      },
      (reason: IpcError) => {
        if (isCurrent()) setError(reason.message);
      },
    );
  }

  function navigate(target: NavigationTarget) {
    switch (target.kind) {
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

  if (!workspace) {
    return (
      <main className="app">
        <h1>md-peruse</h1>
        <p>メニューの「ファイル」から「フォルダーを開く」を選んでください。</p>
      </main>
    );
  }

  return (
    <main className="app">
      <h1>{workspace.label}</h1>
      {error && <p role="alert">{error}</p>}
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
      {document && (
        <MarkdownDocument
          text={document.content.text}
          path={document.content.path}
          anchor={document.anchor}
          onNavigate={navigate}
          issueImages={issueImageResources}
        />
      )}
    </main>
  );
}
