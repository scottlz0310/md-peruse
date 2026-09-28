import { describe, expect, test } from "bun:test";
import { windowTitle } from "./window-title";

describe("windowTitle", () => {
  test.each([
    [null, null, "md-peruse"],
    ["src\\docs", null, "src\\docs - md-peruse"],
    ["src\\docs", "README.md", "README.md - src\\docs - md-peruse"],
    ["src\\docs", "guide/deep/a.md", "a.md - src\\docs - md-peruse"],
  ])("表示名 %p、文書 %p は %p", (label, path, expected) => {
    expect(windowTitle(label, path)).toBe(expected);
  });
});
