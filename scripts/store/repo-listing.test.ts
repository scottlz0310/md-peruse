import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readListingTable } from "./csv";
import {
  buildListingPatch,
  FEATURE_LIMIT,
  KEYWORD_LIMIT,
  SCREENSHOT_LIMIT,
} from "./listing";
import { resolveImagePath } from "./plan";

// リポジトリの掲載情報（docs/assets/store）が、提出ツールで読めることを守る。
// 件数などの中身には依存せず、構造（言語の列、画像の実在、上限）だけを確かめる。
const dir = join(import.meta.dir, "../../docs/assets/store");
const table = readListingTable(
  readFileSync(join(dir, "listingData.csv"), "utf8"),
);

describe("リポジトリの掲載情報 CSV", () => {
  test("日本語と英語の列がある", () => {
    expect(table.columns).toEqual(
      expect.arrayContaining(["default", "ja-jp", "en-us"]),
    );
  });

  test.each(["ja-jp", "en-us"])(
    "%s: 申請へ反映する内容が揃っている",
    (language) => {
      const patch = buildListingPatch(table, language);

      expect(patch.text.title).toBe("md-peruse");
      expect(patch.text.description).toBeTruthy();
      expect(patch.text.shortDescription).toBeTruthy();
      expect(patch.features?.length).toBeGreaterThan(0);
      expect(patch.features?.length).toBeLessThanOrEqual(FEATURE_LIMIT);
      expect(patch.keywords?.length).toBeGreaterThan(0);
      expect(patch.keywords?.length).toBeLessThanOrEqual(KEYWORD_LIMIT);
    },
  );

  test.each(["ja-jp", "en-us"])(
    "%s: スクリーンショットが、フォルダー内に実在し、字幕がある",
    (language) => {
      const screenshots = buildListingPatch(table, language).screenshots ?? [];
      expect(screenshots.length).toBeGreaterThan(0);
      expect(screenshots.length).toBeLessThanOrEqual(SCREENSHOT_LIMIT);

      for (const shot of screenshots) {
        const relative = resolveImagePath(shot.path, "store");
        expect(existsSync(join(dir, relative))).toBe(true);
        expect(shot.description).not.toBe("");
      }
    },
  );
});
