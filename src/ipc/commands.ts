import { invoke } from "@tauri-apps/api/core";
import type { FileContent } from "../types/generated/FileContent";
import type { ImageResource } from "../types/generated/ImageResource";
import type { ScanResult } from "../types/generated/ScanResult";

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
