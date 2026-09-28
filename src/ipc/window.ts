import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * メインウィンドウの操作。
 *
 * capabilityで許可しているのはタイトルの設定だけである（design-decisions.md 5.5）。
 * Tauriのウィンドウタイトルは `document.title` と同期しないため、明示的に設定する。
 */

/** ウィンドウタイトルを設定する（10.1.2）。 */
export function setWindowTitle(title: string): Promise<void> {
  return getCurrentWindow().setTitle(title);
}
