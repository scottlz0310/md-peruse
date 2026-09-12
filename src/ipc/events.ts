import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WorkspaceOpenedEvent } from "../types/generated/WorkspaceOpenedEvent";

/**
 * Rust側から届くTauri eventの購読。
 *
 * event名はRust側の定数（`WORKSPACE_OPENED_EVENT` など）を正本とする。
 */

/** ワークスペースを開いたことを受け取る（design-decisions.md 6.1、10.1）。 */
export function onWorkspaceOpened(
  handler: (event: WorkspaceOpenedEvent) => void,
): Promise<UnlistenFn> {
  return listen<WorkspaceOpenedEvent>("workspace-opened", (event) =>
    handler(event.payload),
  );
}
