import { describe, expect, test } from "bun:test";
import { readListingTable } from "./csv";
import { buildListingPatch } from "./listing";

function table(rows: string[]) {
  return readListingTable(
    `Field,ID,Type,default,ja-jp,en-us\r\n${rows.join("\r\n")}\r\n`,
  );
}

describe("buildListingPatch", () => {
  test("文章の項目を、許可リストの対応で申請のキーへ写す", () => {
    const t = table([
      "Title,4,t,,ja title,en title",
      "Description,2,t,,日本語,English",
      "ReleaseNotes,3,t,,新機能,What's new",
      "ShortDescription,8,t,,短い,Short",
      "DevStudio,9,t,,studio,studio",
      "CopyrightTrademarkInformation,12,t,,(c) ja,(c) en",
    ]);
    expect(buildListingPatch(t, "en-us").text).toEqual({
      title: "en title",
      description: "English",
      releaseNotes: "What's new",
      shortDescription: "Short",
      devStudio: "studio",
      copyrightAndTrademarkInfo: "(c) en",
    });
  });

  test("値が空の項目は未指定にする（申請の値を変えない）", () => {
    const t = table(["Title,4,t,,,only-en", "Description,2,t,,,"]);
    expect(buildListingPatch(t, "ja-jp").text).toEqual({});
    expect(buildListingPatch(t, "en-us").text).toEqual({ title: "only-en" });
  });

  test("許可リストに無い項目は反映しない", () => {
    const t = table(["StoreLogo300x,50,p,,store/logo.png,store/logo.png"]);
    expect(buildListingPatch(t, "ja-jp")).toEqual({
      language: "ja-jp",
      text: {},
    });
  });

  test("複数行の値の改行（CRLF）は変換しない", () => {
    const t = table(['Description,2,t,,"a\r\n\r\nb",x']);
    expect(buildListingPatch(t, "ja-jp").text.description).toBe("a\r\n\r\nb");
  });

  test("機能と検索語は、空でないものを番号順に集める", () => {
    const t = table([
      "Feature1,700,t,,F1,E1",
      "Feature2,701,t,,,",
      "Feature3,702,t,,F3,E3",
      "SearchTerm1,900,t,,k1,e1",
      "SearchTerm2,901,t,,k2,e2",
    ]);
    const ja = buildListingPatch(t, "ja-jp");
    expect(ja.features).toEqual(["F1", "F3"]);
    expect(ja.keywords).toEqual(["k1", "k2"]);
  });

  test("スクリーンショットは、パスと字幕を番号順に対応させる", () => {
    const t = table([
      "DesktopScreenshot1,100,p,,store/a.png,store/a-en.png",
      "DesktopScreenshot2,101,p,,store/b.png,",
      "DesktopScreenshotCaption1,150,t,,字幕1,Caption 1",
      "DesktopScreenshotCaption2,151,t,,字幕2,Caption 2",
    ]);
    expect(buildListingPatch(t, "ja-jp").screenshots).toEqual([
      { path: "store/a.png", description: "字幕1", imageType: "Screenshot" },
      { path: "store/b.png", description: "字幕2", imageType: "Screenshot" },
    ]);
    expect(buildListingPatch(t, "en-us").screenshots).toEqual([
      {
        path: "store/a-en.png",
        description: "Caption 1",
        imageType: "Screenshot",
      },
    ]);
  });

  test("画像も機能も無ければ、その項目は含めない", () => {
    const t = table(["Title,4,t,,x,y"]);
    const patch = buildListingPatch(t, "ja-jp");
    expect(patch.features).toBeUndefined();
    expect(patch.keywords).toBeUndefined();
    expect(patch.screenshots).toBeUndefined();
  });

  test("CSV に無い言語は例外にする", () => {
    expect(() => buildListingPatch(table(["Title,4,t,,a,b"]), "fr-fr")).toThrow(
      "言語の列がありません: fr-fr",
    );
  });
});
