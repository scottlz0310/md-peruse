import { describe, expect, test } from "bun:test";
import { findReleaseNotesProblems } from "./check-release-listing";

function csv(ja: string, en: string): string {
  return [
    "Field,ID,Type,default,ja-jp,en-us",
    `ReleaseNotes,3,Text,,${ja},${en}`,
    "",
  ].join("\r\n");
}

describe("findReleaseNotesProblems", () => {
  test("両方の言語が更新されていれば、問題なし", () => {
    expect(
      findReleaseNotesProblems(csv("旧", "old"), csv("新", "new")),
    ).toEqual([]);
  });

  test("変わっていない言語を返す", () => {
    expect(
      findReleaseNotesProblems(csv("旧", "old"), csv("新", "old")),
    ).toEqual([{ language: "en-us", reason: "unchanged" }]);
  });

  test("両方とも変わっていなければ、両方を返す", () => {
    expect(
      findReleaseNotesProblems(csv("旧", "old"), csv("旧", "old")),
    ).toEqual([
      { language: "ja-jp", reason: "unchanged" },
      { language: "en-us", reason: "unchanged" },
    ]);
  });

  test("空は、前回が空でも問題にする", () => {
    expect(findReleaseNotesProblems(csv("", ""), csv("", "新"))).toEqual([
      { language: "ja-jp", reason: "empty" },
    ]);
  });

  test("前後の空白だけの違いは、変更と見なさない", () => {
    expect(
      findReleaseNotesProblems(csv("旧", "old"), csv('"旧 "', "new")),
    ).toEqual([{ language: "ja-jp", reason: "unchanged" }]);
  });

  test("BOM つきの CSV も読める", () => {
    expect(
      findReleaseNotesProblems(`﻿${csv("旧", "old")}`, csv("新", "new")),
    ).toEqual([]);
  });
});
