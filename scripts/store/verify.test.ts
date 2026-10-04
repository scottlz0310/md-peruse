import { describe, expect, test } from "bun:test";
import type { ListingPatch } from "./listing";
import type { StoreImage, StoreSubmission } from "./plan";
import {
  describeVerification,
  verifyListing,
  verifyReplacement,
} from "./verify";

const image = (
  description: string,
  fileStatus = "Uploaded",
  id: string | null = `id-${description}`,
): StoreImage => ({
  fileName: `${description}.png`,
  fileStatus,
  description,
  imageType: "Screenshot",
  ...(id ? { id } : {}),
});

function submission(
  baseListing: Record<string, unknown>,
  language = "en-us",
): StoreSubmission {
  return {
    id: "s1",
    targetPublishMode: "Immediate",
    listings: { [language]: { baseListing } },
    applicationPackages: [],
  };
}

const patch = (overrides: Partial<ListingPatch> = {}): ListingPatch => ({
  language: "en-us",
  text: { title: "md-peruse", description: "Desc" },
  features: ["f1", "f2"],
  keywords: ["k1"],
  screenshots: [
    { path: "store/cap1.png", description: "cap1", imageType: "Screenshot" },
    { path: "store/cap2.png", description: "cap2", imageType: "Screenshot" },
  ],
  ...overrides,
});

const complete = {
  title: "md-peruse",
  description: "Desc",
  features: ["f1", "f2"],
  keywords: ["k1"],
  images: [image("cap1"), image("cap2")],
};

const failed = (checks: ReturnType<typeof verifyListing>) =>
  checks.filter((c) => !c.ok).map((c) => c.check);

describe("verifyListing", () => {
  test("すべて CSV のとおりなら、すべて ok", () => {
    const results = verifyListing(submission(complete), [patch()]);
    expect(failed(results)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(8);
  });

  test("CSV で指定していない項目は見ない（text と features が無ければ、画像だけ）", () => {
    const results = verifyListing(submission({ images: complete.images }), [
      patch({ text: {}, features: undefined, keywords: undefined }),
    ]);
    expect(results.every((r) => r.check.includes("screenshot"))).toBe(true);
    expect(failed(results)).toEqual([]);
  });

  test("画像を指定していなければ、画像は見ない", () => {
    const results = verifyListing(submission(complete), [
      patch({ screenshots: undefined }),
    ]);
    expect(results.some((r) => r.check.startsWith("screenshot"))).toBe(false);
  });

  test("文章が違えば、その項目が ng で、期待と実際を持つ", () => {
    const results = verifyListing(
      submission({ ...complete, description: "Old" }),
      [patch()],
    );
    expect(failed(results)).toEqual(["文章: description"]);
    const item = results.find((r) => r.check === "文章: description");
    expect(item).toMatchObject({ expected: "Desc", actual: "Old" });
  });

  test.each([
    ["機能の一覧", { ...complete, features: ["f1"] }, "機能の一覧（features）"],
    ["検索語", { ...complete, keywords: ["other"] }, "検索語（keywords）"],
  ])("%s が違えば ng", (_name, listing, check) => {
    expect(failed(verifyListing(submission(listing), [patch()]))).toEqual([
      check,
    ]);
  });

  describe("画像", () => {
    test("画像が、まだ取り込まれていない（PendingUpload、ID なし）なら、取り込みの検査が ng", () => {
      const results = verifyListing(
        submission({
          ...complete,
          images: [
            image("cap1", "PendingUpload", null),
            image("cap2", "PendingUpload", null),
          ],
        }),
        [patch()],
      );
      expect(failed(results)).toEqual([
        "screenshot の取り込み（すべて Uploaded で、ID がある）",
      ]);
      const item = results.find((r) => r.check.includes("取り込み"));
      expect(item?.actual).toBe("PendingUpload×2");
    });

    test("削除待ち（PendingDelete）の画像は、枚数と順序に数えず、残っていれば ng", () => {
      const results = verifyListing(
        submission({
          ...complete,
          images: [
            image("old1", "PendingDelete"),
            image("old2", "PendingDelete"),
            image("cap1"),
            image("cap2"),
          ],
        }),
        [patch()],
      );
      expect(failed(results)).toEqual(["削除待ちの screenshot が残っていない"]);
    });

    test("順序が違えば、順序と字幕の検査が ng（枚数は同じ）", () => {
      const results = verifyListing(
        submission({ ...complete, images: [image("cap2"), image("cap1")] }),
        [patch()],
      );
      expect(failed(results)).toEqual([
        "screenshot の順序と字幕",
        "screenshot のファイル名（CSV の画像名で終わる）",
      ]);
    });

    test("枚数が違えば、枚数と順序の検査が ng", () => {
      const results = verifyListing(
        submission({ ...complete, images: [image("cap1")] }),
        [patch()],
      );
      expect(failed(results)).toEqual([
        "screenshot の枚数",
        "screenshot の順序と字幕",
        "screenshot のファイル名（CSV の画像名で終わる）",
      ]);
    });

    test("Uploaded でも ID が無ければ、取り込みの検査が ng", () => {
      const results = verifyListing(
        submission({
          ...complete,
          images: [image("cap1"), image("cap2", "Uploaded", null)],
        }),
        [patch()],
      );
      expect(failed(results)).toEqual([
        "screenshot の取り込み（すべて Uploaded で、ID がある）",
      ]);
    });

    test("Screenshot 以外の画像（ロゴなど）は、数えない", () => {
      const logo: StoreImage = {
        fileName: "logo.png",
        fileStatus: "Uploaded",
        id: "logo",
        imageType: "Icon",
      };
      const results = verifyListing(
        submission({
          ...complete,
          images: [logo, image("cap1"), image("cap2")],
        }),
        [patch()],
      );
      expect(failed(results)).toEqual([]);
    });
  });

  test("申請に、その言語の掲載情報が無ければ、ng", () => {
    const results = verifyListing(submission(complete, "ja-jp"), [patch()]);
    expect(results).toEqual([
      {
        scope: "en-us",
        check: "掲載情報の言語",
        ok: false,
        expected: "あり",
        actual: "なし",
      },
    ]);
  });

  test("言語ごとに、別々に照合する", () => {
    const s: StoreSubmission = {
      ...submission(complete),
      listings: {
        "en-us": { baseListing: complete },
        "ja-jp": { baseListing: { ...complete, title: "違う" } },
      },
    };
    const results = verifyListing(s, [patch(), patch({ language: "ja-jp" })]);
    expect(results.filter((r) => !r.ok).map((r) => r.scope)).toEqual(["ja-jp"]);
  });
});

describe("describeVerification", () => {
  test("照合する掲載情報が無ければ、その旨を返す", () => {
    expect(describeVerification([])).toContain("--listing");
  });

  test("すべて ok なら、件数と「のとおり」を出す", () => {
    const results = verifyListing(submission(complete), [patch()]);
    const text = describeVerification(results);
    expect(text).toContain(`照合: ${results.length} 件すべて`);
    expect(text).toContain("| ✅ |");
    expect(text).not.toContain("❌");
  });

  test("ng があれば、件数を出し、ng の行に ❌ を付ける", () => {
    const results = verifyListing(
      submission({ ...complete, description: "Old" }),
      [patch()],
    );
    const text = describeVerification(results);
    expect(text).toContain("のうち 1 件が、掲載情報（CSV）と違う");
    expect(text).toContain("| ❌ | en-us | 文章: description |");
  });

  test("表のセルの縦線を、エスケープする", () => {
    const text = describeVerification([
      { scope: "en-us", check: "x", ok: false, expected: "a|b", actual: "c" },
    ]);
    expect(text).toContain("a\\|b");
  });
});

describe("verifyListing: 画像のファイル名（字幕が同じ画像を区別する）", () => {
  const withNames = (names: string[]) =>
    submission({
      ...complete,
      images: names.map((name, i) => ({
        ...image(`cap${i + 1}`),
        fileName: name,
      })),
    });

  test("取り込みで、ZIP の中の名前（images/<言語>/NN-<画像名>）になっても、CSV の画像名で終わっていれば ok", () => {
    const results = verifyListing(
      withNames(["images/en-us/01-cap1.png", "images/en-us/02-cap2.png"]),
      [patch()],
    );
    expect(failed(results)).toEqual([]);
  });

  test("字幕が同じでも、画像の名前が違えば（差し替えの前の画像）、ng", () => {
    const results = verifyListing(
      withNames(["screenshot1.png", "screenshot2.png"]),
      [patch()],
    );
    expect(failed(results)).toEqual([
      "screenshot のファイル名（CSV の画像名で終わる）",
    ]);
    const item = results.find((r) => r.check.includes("ファイル名"));
    expect(item?.expected).toBe("cap1.png / cap2.png");
    expect(item?.actual).toBe("screenshot1.png / screenshot2.png");
  });

  test("CSV の画像名が、別の画像名の末尾に含まれるだけ（-en の違い）でも、区別する", () => {
    const results = verifyListing(withNames(["cap1-en.png", "cap2-en.png"]), [
      patch(),
    ]);
    expect(failed(results)).toEqual([
      "screenshot のファイル名（CSV の画像名で終わる）",
    ]);
  });
});

describe("verifyReplacement（ID で、差し替わったかを確かめる）", () => {
  const imagesOf = (...ids: Array<string | null>): StoreSubmission =>
    submission({
      images: ids.map((id, i) => ({
        ...image(`cap${i + 1}`, "Uploaded", id),
      })),
    });

  test("取り込みの後の ID が、公開済みの ID と、すべて違えば ok", () => {
    const results = verifyReplacement(imagesOf("a", "b"), imagesOf("c", "d"), [
      "en-us",
    ]);
    expect(results).toEqual([
      {
        scope: "en-us",
        check:
          "screenshot が差し替わった（ID が、公開済みの画像の ID と、すべて違う）",
        ok: true,
        expected: "公開済みの ID と重ならない",
        actual: "新しい ID×2",
      },
    ]);
  });

  test("1 つでも同じ ID が残っていれば（差し替わっていない画像がある）、ng で、件数を示す", () => {
    const [result] = verifyReplacement(imagesOf("a", "b"), imagesOf("a", "d"), [
      "en-us",
    ]);
    expect(result?.ok).toBe(false);
    expect(result?.actual).toBe("重なる ID: 1/2 件");
  });

  test("まだ取り込まれていない（ID が無い）なら、ng", () => {
    const [result] = verifyReplacement(imagesOf("a"), imagesOf(null), [
      "en-us",
    ]);
    expect(result?.ok).toBe(false);
    expect(result?.actual).toBe("ID のある画像がない");
  });

  test("削除待ち（PendingDelete）の画像の ID は、取り込みの後の側に数えない", () => {
    const before = imagesOf("a", "b");
    const after = submission({
      images: [
        { ...image("old", "PendingDelete", "a") },
        image("cap1", "Uploaded", "c"),
      ],
    });
    const [result] = verifyReplacement(before, after, ["en-us"]);
    expect(result?.ok).toBe(true);
  });

  test("言語ごとに照合し、差し替えない言語は見ない", () => {
    const before: StoreSubmission = {
      ...submission({ images: [image("cap1", "Uploaded", "a")] }),
      listings: {
        "en-us": { baseListing: { images: [image("cap1", "Uploaded", "a")] } },
        "ja-jp": { baseListing: { images: [image("cap1", "Uploaded", "j")] } },
      },
    };
    const after: StoreSubmission = {
      ...before,
      listings: {
        "en-us": { baseListing: { images: [image("cap1", "Uploaded", "n")] } },
        "ja-jp": { baseListing: { images: [image("cap1", "Uploaded", "j")] } },
      },
    };
    const results = verifyReplacement(before, after, ["en-us"]);
    expect(results.map((r) => [r.scope, r.ok])).toEqual([["en-us", true]]);
  });
});
