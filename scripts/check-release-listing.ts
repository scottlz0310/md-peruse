#!/usr/bin/env bun
// リリースの前に、Store 掲載データの ReleaseNotes（「新機能」の文）が、前回のリリースから
// 変わっていることを検査する。
//
// リリースの流れの store ジョブは、タグが指すコミットの docs/assets/store/listingData.csv を、
// パッケージと一緒に Store へ出す（docs/design-decisions.md 13.7）。ReleaseNotes が前回のままだと、
// 古い「新機能」の文が公開される（v0.2.0 で起きた）。人が守る手順に頼らず、Prepare Release が止める。
// 内容が正しいかは判定できない。変わっていない（または空）ことだけを検出する。
//
// 使い方: bun scripts/check-release-listing.ts <前回のリリースのタグ>   例: v0.2.0

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cellValue, readListingTable } from "./store/csv";

export const LISTING_PATH = "docs/assets/store/listingData.csv";
export const LANGUAGES = ["ja-jp", "en-us"] as const;

export interface ReleaseNotesProblem {
  language: string;
  reason: "empty" | "unchanged";
}

/** 前回のリリースの CSV と今の CSV を比べ、更新されていない言語を返す。 */
export function findReleaseNotesProblems(
  previousCsv: string,
  currentCsv: string,
  languages: readonly string[] = LANGUAGES,
): ReleaseNotesProblem[] {
  const previous = readListingTable(previousCsv);
  const current = readListingTable(currentCsv);
  const problems: ReleaseNotesProblem[] = [];
  for (const language of languages) {
    const now = cellValue(current, "ReleaseNotes", language).trim();
    if (now === "") {
      problems.push({ language, reason: "empty" });
    } else if (now === cellValue(previous, "ReleaseNotes", language).trim()) {
      problems.push({ language, reason: "unchanged" });
    }
  }
  return problems;
}

function main(): number {
  const tag = process.argv[2];
  if (!tag) {
    console.error(
      "使い方: bun scripts/check-release-listing.ts <前回のリリースのタグ>",
    );
    return 2;
  }
  const shown = spawnSync("git", ["show", `${tag}:${LISTING_PATH}`], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (shown.status !== 0) {
    console.error(
      `${tag} 時点の ${LISTING_PATH} を読めません: ${shown.stderr.trim()}`,
    );
    return 2;
  }
  const root = join(import.meta.dir, "..");
  const problems = findReleaseNotesProblems(
    shown.stdout,
    readFileSync(join(root, LISTING_PATH), "utf8"),
  );
  for (const { language, reason } of problems) {
    console.error(
      reason === "empty"
        ? `::error::${LISTING_PATH} の ReleaseNotes（${language}）が空です。`
        : `::error::${LISTING_PATH} の ReleaseNotes（${language}）が、前回のリリース（${tag}）から変わっていません。この版の内容に更新し、PR でマージしてから、やり直してください（docs/store-submission.md 9.7）。`,
    );
  }
  if (problems.length === 0) {
    console.log(
      `ReleaseNotes は、前回のリリース（${tag}）から更新されています。`,
    );
  }
  return problems.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main());
