import type { UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { readFile, scanDirectory } from "./ipc/commands";
import { onWorkspaceOpened } from "./ipc/events";
import type { FileContent } from "./types/generated/FileContent";
import type { FileNode } from "./types/generated/FileNode";
import type { IpcError } from "./types/generated/IpcError";
import type { WorkspaceOpenedEvent } from "./types/generated/WorkspaceOpenedEvent";

// Rust側のcommandとeventを実際に通すための仮の画面である（dev-flow 第6章）。
// ツリー（6.2）とプレビュー（8章）の実装で置き換える。

export default function App() {
  const [workspace, setWorkspace] = useState<WorkspaceOpenedEvent | null>(null);
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [document, setDocument] = useState<FileContent | null>(null);
  const [error, setError] = useState<IpcError | null>(null);
  // 応答が届いた時点のスコープと照合し、切り替え前の要求の応答を捨てる（5.3）。
  const scopeRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    onWorkspaceOpened((opened) => {
      scopeRef.current = opened.scopeId;
      setWorkspace(opened);
      setEntries([]);
      setDocument(null);
      setError(null);
      scanDirectory("").then(
        (result) => {
          if (scopeRef.current === opened.scopeId) setEntries(result.entries);
        },
        (reason: IpcError) => {
          if (scopeRef.current === opened.scopeId) setError(reason);
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

  function open(node: FileNode) {
    const scopeId = scopeRef.current;
    readFile(node.path).then(
      (content) => {
        if (scopeRef.current === scopeId) {
          setDocument(content);
          setError(null);
        }
      },
      (reason: IpcError) => {
        if (scopeRef.current === scopeId) setError(reason);
      },
    );
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
      {error && <p role="alert">{error.message}</p>}
      <ul>
        {entries.map((node) => (
          <li key={node.path}>
            {node.kind === "markdown" ? (
              <button type="button" onClick={() => open(node)}>
                {node.name}
              </button>
            ) : (
              node.name
            )}
          </li>
        ))}
      </ul>
      {document && <pre>{document.text}</pre>}
    </main>
  );
}
