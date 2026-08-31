import { describe, expect, test } from "bun:test";
import {
  anchorElementId,
  footnoteElementId,
  HEADING_ID_PREFIX,
  headingSlugOptions,
} from "./heading-id";

describe("anchorElementId", () => {
  test.each([
    // 断片, 期待するID
    ["sec", "user-content-sec"],
    ["%E8%A6%8B%E5%87%BA%E3%81%97", "user-content-見出し"],
    ["getting-started", "user-content-getting-started"],
    // 利用者が前置を書いても、その文字列ごと前置の下へ入る。
    ["user-content-fn-1", "user-content-user-content-fn-1"],
  ])("%s は %s を指す", (fragment, expected) => {
    expect(anchorElementId(fragment)).toBe(expected);
  });

  test.each([
    // 空の断片, 復号できない断片
    ["", "遷移先がない"],
    ["%ZZ", "復号できない"],
    ["%E8%A6", "途中で切れている"],
  ])("%s は解決できない（%s）", (fragment) => {
    expect(anchorElementId(fragment)).toBeNull();
  });
});

describe("footnoteElementId", () => {
  test("前置済みのIDへは前置しない", () => {
    expect(footnoteElementId("user-content-fn-1")).toBe("user-content-fn-1");
    expect(footnoteElementId("user-content-fnref-1")).toBe(
      "user-content-fnref-1",
    );
  });

  test("復号できない断片は解決できない", () => {
    expect(footnoteElementId("%ZZ")).toBeNull();
  });
});

describe("headingSlugOptions", () => {
  test("脚注と同じ前置を rehype-slug へ渡す", () => {
    expect(headingSlugOptions.prefix).toBe(HEADING_ID_PREFIX);
  });
});
