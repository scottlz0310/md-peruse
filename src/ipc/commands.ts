import { invoke } from "@tauri-apps/api/core";
import type { FileContent } from "../types/generated/FileContent";
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
