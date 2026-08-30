import { describe, expect, test } from "bun:test";
import { isRetryable } from "./error";
import type { ErrorCode } from "./generated/ErrorCode";

describe("isRetryable", () => {
  test.each<[ErrorCode, boolean]>([
    ["workspaceAccessDenied", true],
    ["directoryAccessDenied", true],
    ["fileAccessDenied", true],
    ["fileLocked", true],
    ["watcherOverflow", true],
    ["watcherStopped", true],
    ["workspaceNotFound", false],
    ["directoryNotFound", false],
    ["pathOutsideWorkspace", false],
    ["pathRejected", false],
    ["fileNotFound", false],
    ["fileTooLarge", false],
    ["decodeFailed", false],
    ["settingsCorrupted", false],
  ])("%s は %s", (code, expected) => {
    expect(isRetryable(code)).toBe(expected);
  });
});
