import { invoke } from "@tauri-apps/api/core";
import type { PathFormat } from "../path-menu/PathMenu";
import type { FileContent } from "../types/generated/FileContent";
import type { ImageResource } from "../types/generated/ImageResource";
import type { OpenMdResult } from "../types/generated/OpenMdResult";
import type { ScanResult } from "../types/generated/ScanResult";
import type { UiSettings } from "../types/generated/UiSettings";
import type { UiSettingsUpdate } from "../types/generated/UiSettingsUpdate";
import type { WorkspaceOpenedEvent } from "../types/generated/WorkspaceOpenedEvent";

/**
 * Rust側のTauri commandの呼び出し（design-decisions.md 5.3）。
 *
 * command名と引数の形はRust側（`src-tauri/src/ipc/commands.rs`）を正本とする。失敗は
 * `IpcError` としてrejectされ、Frontendは `code` で分岐する。
 */

/** ディレクトリ1階層を走査する。ルート直下は空文字を渡す。 */
export function scanDirectory(path: string): Promise<ScanResult> {
  return invoke<ScanResult>("scan_directory_command", { request: { path } });
}

/**
 * ファイルを1件読み込む。`path` はスコープのルートからの相対パス。
 *
 * `scopeId` はワークスペース、またはloose tabの暗黙のルート（9.1）を指す。開いていない
 * スコープ（閉じたloose tab、切り替え前のワークスペース）は `workspaceNotFound` で拒否される。
 */
export function readFile(scopeId: string, path: string): Promise<FileContent> {
  return invoke<FileContent>("read_file_command", {
    request: { scopeId, path },
  });
}

/**
 * loose tabの監視先を、タブが表示している文書へ付け替える（design-decisions.md 6.4）。
 *
 * 読込の応答を採用したとき（世代の判定を通ったとき）だけ呼ぶ。読んだだけで付け替えると、
 * 素早くリンクを辿って応答が逆順に完了したとき、捨てた古い応答の文書へ監視が移る。
 * `tabId` と `generation` は、その読込のタブと世代で、Rust側は古い要求を捨てる。
 */
export function watchLooseDocument(
  scopeId: string,
  path: string,
  tabId: string,
  generation: number,
): Promise<void> {
  return invoke<void>("watch_loose_document_command", {
    request: { scopeId, path, tabId, generation },
  });
}

/**
 * loose tabのスコープを閉じ、そのファイルの監視を止める（design-decisions.md 6.4、9.1）。
 *
 * タブを閉じたときと、上限で退避されたときに呼ぶ。開いていないスコープには何も起きない。
 */
export function closeLooseScope(scopeId: string): Promise<void> {
  return invoke<void>("close_loose_scope_command", { scopeId });
}

/** 起動時の設定を得る（design-decisions.md 11.1）。 */
export function getUiSettings(): Promise<UiSettings> {
  return invoke<UiSettings>("get_ui_settings_command");
}

/**
 * 変わった設定を保存する。指定した項目だけを変える。
 *
 * 書込みはRust側がまとめてから行い、この呼び出しは書込みを待たない（11.1）。値の範囲は
 * 呼び出し側が丸めてから渡す。
 */
export function updateUiSettings(update: UiSettingsUpdate): Promise<void> {
  return invoke<void>("update_ui_settings_command", { update });
}

/**
 * 文書が参照する画像に、まとめてresource IDを発行する（design-decisions.md 5.4）。
 *
 * `references` はMarkdownから得た参照文字列をそのまま渡し、解決と検証はRust側が行う。
 * 応答は要素ごとに成功と失敗を持つ。
 */
export function issueImageResources(
  scopeId: string,
  documentPath: string,
  references: string[],
): Promise<ImageResource[]> {
  return invoke<ImageResource[]>("issue_image_resources_command", {
    request: { scopeId, documentPath, references },
  });
}

/**
 * いま開いているワークスペースを問い合わせる。開いていなければ `null` を返す
 * （design-decisions.md 9.2、11.1）。
 *
 * 起動時にRustが最後のワークスペースを開き直すと、その `workspace-opened` はWebViewの購読より
 * 先に送られうる。`workspace-opened` を購読してから呼び、購読後の変化はeventで受ける。
 */
export function getWorkspace(): Promise<WorkspaceOpenedEvent | null> {
  return invoke<WorkspaceOpenedEvent | null>("get_workspace_command");
}

/**
 * Frontendの準備が済んだことを知らせる（design-decisions.md 9.2）。
 *
 * `open-document` を購読し、`getWorkspace` の応答を反映したあとに呼ぶ。関連付け起動で渡された
 * ファイルは、この呼び出しまでRustが保留し、呼び出しのあとに `open-document` で届く。
 * 購読より先に呼ぶと、届いた指示を受け取れない。何度呼んでもよい。
 */
export function notifyFrontendReady(): Promise<void> {
  return invoke<void>("frontend_ready_command");
}

/**
 * 文書を表示した結果を知らせる（design-decisions.md 11.4）。
 *
 * Store向けカスタムイベント `open_md_ok` と `open_md_fail` の発火点である。`"fail"` は、文書全体を
 * 描画できず失敗を表示したときに限る。数式・図・画像の位置だけの失敗は含めない。
 * イベント名そのものは渡さない。送るかどうか、1セッションに1回だけにすることは、Rust側が
 * 決める。
 */
export function reportOpenResult(result: OpenMdResult): Promise<void> {
  return invoke<void>("report_open_result_command", { result });
}

/**
 * 最近使ったフォルダーの項目をワークスペースとして開く。
 *
 * 成功は `workspace-opened` で届く（フォルダー選択と同じ経路）。`id` は `recent-folders-changed`
 * と設定で受け取ったもの。一覧が変わると振り直されるため、古い `id` は拒否される。
 */
export function openRecentFolder(id: string): Promise<void> {
  return invoke<void>("open_recent_folder_command", { id });
}

export function copyPath(
  scopeId: string,
  path: string,
  format: PathFormat,
): Promise<void> {
  return invoke<void>("copy_path_command", {
    request: { scopeId, path, format },
  });
}
