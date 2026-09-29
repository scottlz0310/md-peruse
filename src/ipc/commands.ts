import { invoke } from "@tauri-apps/api/core";
import type { FileContent } from "../types/generated/FileContent";
import type { ImageResource } from "../types/generated/ImageResource";
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

/** ファイルを1件読み込む。`path` はワークスペース相対パス。 */
export function readFile(path: string): Promise<FileContent> {
  return invoke<FileContent>("read_file_command", { request: { path } });
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
  documentPath: string,
  references: string[],
): Promise<ImageResource[]> {
  return invoke<ImageResource[]>("issue_image_resources_command", {
    request: { documentPath, references },
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
 * 最近使ったフォルダーの項目をワークスペースとして開く。
 *
 * 成功は `workspace-opened` で届く（フォルダー選択と同じ経路）。`id` は `recent-folders-changed`
 * と設定で受け取ったもの。一覧が変わると振り直されるため、古い `id` は拒否される。
 */
export function openRecentFolder(id: string): Promise<void> {
  return invoke<void>("open_recent_folder_command", { id });
}
