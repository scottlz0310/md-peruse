import type { ErrorCode } from "./generated/ErrorCode";

/**
 * 再試行可否は `code` から導出する。IPCの応答には含めない（design-decisions.md 5.3）。
 */
//
// `Record<ErrorCode, boolean>` としているため、Rust側で `ErrorCode` を増やすと
// 生成物の union が変わり、この表に漏れがあれば `tsc --noEmit` が失敗する。
const RETRYABLE: Record<ErrorCode, boolean> = {
  // 権限やロックは、ユーザーが状況を変えてから再実行できる。
  workspaceAccessDenied: true,
  directoryAccessDenied: true,
  fileAccessDenied: true,
  fileLocked: true,
  // 取りこぼしや監視停止は、再取得で回復しうる。
  watcherOverflow: true,
  watcherStopped: true,
  // 対象そのものが要件を満たさないため、同じ操作を繰り返しても結果は変わらない。
  workspaceNotFound: false,
  directoryNotFound: false,
  pathOutsideWorkspace: false,
  pathRejected: false,
  fileNotFound: false,
  fileTooLarge: false,
  decodeFailed: false,
  // 破損した設定は既定値へ戻して続行する。再読込しても壊れたままである。
  settingsCorrupted: false,
};

/** ユーザーが明示的に再実行できる失敗かを返す。 */
export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE[code];
}
