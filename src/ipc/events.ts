import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DragState } from "../types/generated/DragState";
import type { FileChangeEvent } from "../types/generated/FileChangeEvent";
import type { ImagesChangedEvent } from "../types/generated/ImagesChangedEvent";
import type { LanguageChangedEvent } from "../types/generated/LanguageChangedEvent";
import type { MenuCommand } from "../types/generated/MenuCommand";
import type { OpenDocumentEvent } from "../types/generated/OpenDocumentEvent";
import type { RecentFoldersChangedEvent } from "../types/generated/RecentFoldersChangedEvent";
import type { WatcherErrorEvent } from "../types/generated/WatcherErrorEvent";
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
 * ファイル変更の通知を受け取る（design-decisions.md 6.4、6.5）。
 *
 * Rust側でdebounceし、atomic replaceを削除と誤判定しないよう確定させてから届く。
 * `scopeId` が自分の保持するスコープと一致しない通知は、受け手が破棄する。
 */
export function onFileChange(
  handler: (event: FileChangeEvent) => void,
): Promise<UnlistenFn> {
  return listen<FileChangeEvent>("file-change", (event) =>
    handler(event.payload),
  );
}

/**
 * 監視が追従できなくなったことを受け取る（design-decisions.md 6.4）。
 *
 * 変更が多すぎて個別に追えないとき（`watcherOverflow`）と、監視そのものが止まったとき
 * （`watcherStopped`）に届く。
 */
export function onWatcherError(
  handler: (event: WatcherErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<WatcherErrorEvent>("watcher-error", (event) =>
    handler(event.payload),
  );
}

/**
 * 発行済みの画像が書き換わったことを受け取る（design-decisions.md 5.4）。
 *
 * どの画像かは伝わらない。表示中の文書の画像を発行し直す契機として使う。
 */
export function onImagesChanged(
  handler: (event: ImagesChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen<ImagesChangedEvent>("images-changed", (event) =>
    handler(event.payload),
  );
}

/**
 * ドラッグ中の受け入れ可否を受け取る（design-decisions.md 10.4）。
 *
 * ドロップされたパスはRust側が受け取り、Frontendへは渡らない（7.1）。ここへ届くのは
 * `DragState` だけで、オーバーレイの表示に使う。
 */
export function onDragState(
  handler: (state: DragState) => void,
): Promise<UnlistenFn> {
  return listen<DragState>("drag-state", (event) => handler(event.payload));
}

/**
 * 文書をタブで開く指示を受け取る（design-decisions.md 9.1、10.4）。
 *
 * ドロップされたファイルを、Rust側が開く場所（ワークスペースの通常タブ、またはloose tab）を
 * 決めて知らせる。開き先はスコープIDとスコープ相対パスで、絶対パスは含まない。
 */
export function onOpenDocument(
  handler: (event: OpenDocumentEvent) => void,
): Promise<UnlistenFn> {
  return listen<OpenDocumentEvent>("open-document", (event) =>
    handler(event.payload),
  );
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
