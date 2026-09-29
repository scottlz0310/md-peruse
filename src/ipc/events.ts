import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { LanguageChangedEvent } from "../types/generated/LanguageChangedEvent";
import type { MenuCommand } from "../types/generated/MenuCommand";
import type { RecentFoldersChangedEvent } from "../types/generated/RecentFoldersChangedEvent";
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

/**
 * ワークスペースを閉じたことを受け取る（design-decisions.md 6.1、10.1）。
 *
 * Rust側は監視と画像resource IDを破棄してから送る。
 */
export function onWorkspaceClosed(handler: () => void): Promise<UnlistenFn> {
  return listen("workspace-closed", () => handler());
}

/**
 * Frontendが処理するメニューコマンドを受け取る（design-decisions.md 10.1）。
 *
 * メニューの選択と、WebViewにフォーカスがあるときのアクセラレータの両方がここへ届く。
 */
export function onMenuCommand(
  handler: (command: MenuCommand) => void,
): Promise<UnlistenFn> {
  return listen<MenuCommand>("menu-command", (event) => handler(event.payload));
}

/**
 * UIの表示言語が切り替わったことを受け取る（design-decisions.md 10.5）。
 *
 * メニューからの切り替えをRust側が処理し、設定の保存とメニューの組み直しを済ませてから
 * 送る。OSの表示言語は監視しないため、メニューから選んだとき以外には届かない。
 */
export function onLanguageChanged(
  handler: (event: LanguageChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen<LanguageChangedEvent>("language-changed", (event) =>
    handler(event.payload),
  );
}

/**
 * 最近使ったフォルダーの一覧が変わったことを受け取る（design-decisions.md 11.1）。
 *
 * 一覧は新しいものが先頭で、IDは作り直すたびに振り直される。受け取った一覧で手元の一覧を
 * 丸ごと置き換える。
 */
export function onRecentFoldersChanged(
  handler: (event: RecentFoldersChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen<RecentFoldersChangedEvent>("recent-folders-changed", (event) =>
    handler(event.payload),
  );
}
