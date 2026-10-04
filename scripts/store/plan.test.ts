import { describe, expect, test } from "bun:test";
import type { ListingPatch } from "./listing";
import {
  assertNoPendingSubmission,
  assertPublishMode,
  describePlan,
  diffTopLevel,
  initializeDeviceFamilies,
  type PlanInput,
  planSubmission,
  resolveImagePath,
  type StoreSubmission,
} from "./plan";

function base(): StoreSubmission {
  return {
    id: "sub1",
    targetPublishMode: "Manual",
    status: "PendingCommit",
    pricing: { trialPeriod: "NoFreeTrial" },
    listings: {
      "ja-jp": {
        baseListing: {
          title: "md-peruse",
          description: "旧い説明",
          releaseNotes: "",
          features: ["旧"],
          keywords: ["k1"],
          images: [
            {
              fileName: "old1.png",
              fileStatus: "Uploaded",
              id: "1",
              description: "旧字幕1",
              imageType: "Screenshot",
            },
            {
              fileName: "old2.png",
              fileStatus: "Uploaded",
              id: "2",
              description: "旧字幕2",
              imageType: "Screenshot",
            },
            {
              fileName: "logo.png",
              fileStatus: "Uploaded",
              id: "3",
              imageType: "StoreLogo9x16",
            },
          ],
        },
      },
      "en-us": { baseListing: { title: "md-peruse", images: [] } },
    },
    applicationPackages: [
      {
        fileName: "md-peruse_0.1.0.0_x64.msixupload",
        fileStatus: "Uploaded",
        minimumDirectXVersion: "DirectX10",
        minimumSystemRam: "Ram2GB",
      },
    ],
  };
}

const image = (name: string) => new TextEncoder().encode(`bytes:${name}`);

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    patches: [],
    replaceScreenshots: false,
    listingRoot: "store",
    readImage: image,
    ...overrides,
  };
}

const jaPatch = (extra: Partial<ListingPatch> = {}): ListingPatch => ({
  language: "ja-jp",
  text: {},
  ...extra,
});

describe("planSubmission: 文章", () => {
  test("値が違う項目だけを変更し、変更前後を残す", () => {
    const plan = planSubmission(
      base(),
      input({
        patches: [
          jaPatch({ text: { description: "新しい説明", title: "md-peruse" } }),
        ],
      }),
    );
    expect(plan.changes).toEqual([
      {
        scope: "ja-jp",
        field: "description",
        kind: "set",
        before: "旧い説明",
        after: "新しい説明",
      },
    ]);
    expect(plan.submission.listings["ja-jp"]?.baseListing.description).toBe(
      "新しい説明",
    );
  });

  test("同じ値（改行も同じ）なら、変更なし", () => {
    const b = base();
    (
      b.listings["ja-jp"] as { baseListing: { description: string } }
    ).baseListing.description = "a\r\n\r\nb";
    const plan = planSubmission(
      b,
      input({ patches: [jaPatch({ text: { description: "a\r\n\r\nb" } })] }),
    );
    expect(plan.changes).toEqual([]);
  });

  test("機能と検索語は、内容が違うときだけ置き換える", () => {
    const same = planSubmission(
      base(),
      input({ patches: [jaPatch({ features: ["旧"], keywords: ["k1"] })] }),
    );
    expect(same.changes).toEqual([]);

    const changed = planSubmission(
      base(),
      input({
        patches: [jaPatch({ features: ["新1", "新2"], keywords: ["k2"] })],
      }),
    );
    expect(changed.changes.map((c) => c.field)).toEqual([
      "features",
      "keywords",
    ]);
    expect(changed.submission.listings["ja-jp"]?.baseListing.features).toEqual([
      "新1",
      "新2",
    ]);
  });

  test("元の申請と、扱わない項目は変えない", () => {
    const original = base();
    const snapshot = structuredClone(original);
    const plan = planSubmission(
      original,
      input({ patches: [jaPatch({ text: { description: "新" } })] }),
    );
    expect(original).toEqual(snapshot);
    expect(plan.submission.pricing).toEqual({ trialPeriod: "NoFreeTrial" });
    expect(plan.submission.applicationPackages).toEqual(
      original.applicationPackages,
    );
  });

  test("申請に無い言語は例外にする", () => {
    expect(() =>
      planSubmission(
        base(),
        input({ patches: [{ language: "fr-fr", text: { title: "x" } }] }),
      ),
    ).toThrow("申請に掲載情報の言語がありません: fr-fr");
  });
});

describe("planSubmission: スクリーンショット", () => {
  const screenshots = [
    {
      path: "store/shot1.png",
      description: "字幕1",
      imageType: "Screenshot" as const,
    },
    {
      path: "store/shot2.png",
      description: "字幕2",
      imageType: "Screenshot" as const,
    },
  ];

  test("差し替えを指定したときだけ、画像を入れ替える", () => {
    const off = planSubmission(
      base(),
      input({ patches: [jaPatch({ screenshots })], replaceScreenshots: false }),
    );
    expect(off.changes).toEqual([]);
    expect(off.uploads).toEqual([]);
  });

  test("既存のスクリーンショットを PendingDelete にし、新しい画像を順に追加する", () => {
    const plan = planSubmission(
      base(),
      input({ patches: [jaPatch({ screenshots })], replaceScreenshots: true }),
    );
    const images = plan.submission.listings["ja-jp"]?.baseListing.images ?? [];

    expect(
      images.filter((i) => i.fileStatus === "PendingDelete").map((i) => i.id),
    ).toEqual(["1", "2"]);
    // ロゴなど、スクリーンショット以外は触らない。
    expect(
      images.find((i) => i.imageType === "StoreLogo9x16")?.fileStatus,
    ).toBe("Uploaded");
    const added = images.filter((i) => i.fileStatus === "PendingUpload");
    expect(added.map((i) => [i.fileName, i.description])).toEqual([
      ["images/ja-jp/01-shot1.png", "字幕1"],
      ["images/ja-jp/02-shot2.png", "字幕2"],
    ]);
    expect(plan.uploads.map((u) => u.name)).toEqual(
      added.map((i) => i.fileName),
    );
    expect(new TextDecoder().decode(plan.uploads[0]?.data)).toBe(
      "bytes:shot1.png",
    );
  });

  test("言語ごとに別のパスで格納する（同じ画像を複数の言語で使える）", () => {
    const plan = planSubmission(
      base(),
      input({
        patches: [
          jaPatch({ screenshots }),
          { language: "en-us", text: {}, screenshots },
        ],
        replaceScreenshots: true,
      }),
    );
    const names = plan.uploads.map((u) => u.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("images/en-us/01-shot1.png");
  });

  test("画像のパスがフォルダー名で始まらなければ例外にする", () => {
    expect(() =>
      planSubmission(
        base(),
        input({
          patches: [
            jaPatch({
              screenshots: [
                {
                  path: "other/x.png",
                  description: "",
                  imageType: "Screenshot",
                },
              ],
            }),
          ],
          replaceScreenshots: true,
        }),
      ),
    ).toThrow("画像の参照が不正です");
  });
});

describe("planSubmission: パッケージ", () => {
  test("既存を PendingDelete にして、新しいパッケージを追加する", () => {
    const data = new Uint8Array([1, 2, 3]);
    const plan = planSubmission(
      base(),
      input({
        packageFile: { name: "md-peruse_0.1.1.0_x64.msixupload", data },
      }),
    );
    expect(plan.submission.applicationPackages).toEqual([
      {
        fileName: "md-peruse_0.1.0.0_x64.msixupload",
        fileStatus: "PendingDelete",
        minimumDirectXVersion: "DirectX10",
        minimumSystemRam: "Ram2GB",
      },
      {
        fileName: "md-peruse_0.1.1.0_x64.msixupload",
        fileStatus: "PendingUpload",
        minimumDirectXVersion: "DirectX10",
        minimumSystemRam: "Ram2GB",
      },
    ]);
    expect(plan.uploads).toEqual([
      { name: "md-peruse_0.1.1.0_x64.msixupload", data },
    ]);
    expect(plan.changes.map((c) => [c.scope, c.kind])).toEqual([
      ["package", "delete"],
      ["package", "add"],
    ]);
  });
});

describe("resolveImagePath", () => {
  test.each([
    ["store/shot.png", "store", "shot.png"],
    ["store/sub/shot.png", "store", "sub/shot.png"],
  ])("正しい参照 %s", (path, root, expected) => {
    expect(resolveImagePath(path, root)).toBe(expected);
  });

  test.each([
    ["フォルダー名が違う", "other/shot.png"],
    ["フォルダー名だけ", "store/"],
    ["親ディレクトリ", "store/../x.png"],
    ["絶対パス", "store//x.png"],
    ["バックスラッシュ", "store/a\\b.png"],
    ["相対パスでない", "shot.png"],
  ])("不正な参照は例外にする: %s", (_name, path) => {
    expect(() => resolveImagePath(path, "store")).toThrow(
      "画像の参照が不正です",
    );
  });
});

describe("安全チェック", () => {
  test("処理中の申請があれば例外にする（自動では消さない）", () => {
    expect(() =>
      assertNoPendingSubmission({
        id: "app",
        pendingApplicationSubmission: { id: "pending9" },
      }),
    ).toThrow("処理中の申請が残っています（id: pending9）");
    expect(() => assertNoPendingSubmission({ id: "app" })).not.toThrow();
  });

  test.each([
    ["Immediate", "Manual"],
    ["Manual", "Immediate"],
    ["SpecificDate", "Manual"],
    ["SpecificDate", "Immediate"],
    ["", "Manual"],
  ] as const)(
    "申請の公開方法 %p が期待 %p と違えば例外にする",
    (mode, expected) => {
      expect(() =>
        assertPublishMode({ ...base(), targetPublishMode: mode }, expected),
      ).toThrow(`申請: ${mode}、期待: ${expected}`);
    },
  );

  test.each(["Manual", "Immediate"] as const)(
    "申請の公開方法が期待（%s）と一致すれば通る",
    (mode) => {
      expect(() =>
        assertPublishMode({ ...base(), targetPublishMode: mode }, mode),
      ).not.toThrow();
    },
  );
});

describe("diffTopLevel", () => {
  test("申請ごとに変わる項目（id・friendlyName・status・fileUploadUrl など）は無視する", () => {
    const a = { ...base(), friendlyName: "Submission 1" };
    const b = {
      ...base(),
      id: "sub2",
      friendlyName: "Submission 3",
      status: "CommitStarted",
      statusDetails: { errors: [] },
      fileUploadUrl: "https://blob.example/x",
      resourceLocation: "applications/app/submissions/sub2",
    };
    expect(diffTopLevel(a, b)).toEqual([]);
  });

  const submission = (patch: Record<string, unknown>): StoreSubmission => ({
    ...base(),
    ...patch,
  });

  test.each([
    [
      "オブジェクトのキー順だけが違う（入れ子を含む）",
      {
        pricing: {
          trialPeriod: "NoFreeTrial",
          markets: ["US", "JP"],
          sale: { start: 1, end: 2 },
        },
      },
      {
        pricing: {
          sale: { end: 2, start: 1 },
          markets: ["US", "JP"],
          trialPeriod: "NoFreeTrial",
        },
      },
    ],
    [
      "掲載情報のキー順だけが違う",
      {
        listings: {
          "ja-jp": { baseListing: { title: "a", description: "b" } },
        },
      },
      {
        listings: {
          "ja-jp": { baseListing: { description: "b", title: "a" } },
        },
      },
    ],
  ])("内容が同じなら、違いとして扱わない: %s", (_name, left, right) => {
    expect(diffTopLevel(submission(left), submission(right))).toEqual([]);
  });

  test.each([
    [
      "価格が変わった",
      { pricing: { trialPeriod: "NoFreeTrial" } },
      { pricing: { trialPeriod: "Unknown" } },
      ["pricing"],
    ],
    [
      "配列の順序が違う（順序には意味がある）",
      { pricing: { markets: ["US", "JP"] } },
      { pricing: { markets: ["JP", "US"] } },
      ["pricing"],
    ],
    [
      "入れ子の値が違う",
      { listings: { "ja-jp": { baseListing: { title: "a" } } } },
      { listings: { "ja-jp": { baseListing: { title: "b" } } } },
      ["listings"],
    ],
    [
      "入れ子のキーが片方にだけある",
      { pricing: { trialPeriod: "NoFreeTrial" } },
      { pricing: { trialPeriod: "NoFreeTrial", extra: 1 } },
      ["pricing"],
    ],
    ["オブジェクトと配列は別物", { pricing: {} }, { pricing: [] }, ["pricing"]],
    [
      "公開方法と価格が変わった（名前順）",
      { targetPublishMode: "Manual", pricing: { trialPeriod: "NoFreeTrial" } },
      { targetPublishMode: "Immediate", pricing: null },
      ["pricing", "targetPublishMode"],
    ],
    ["片方にだけ項目がある", {}, { extra: 1 }, ["extra"]],
  ])("違う項目の名前を返す: %s", (_name, left, right, expected) => {
    expect(diffTopLevel(submission(left), submission(right))).toEqual(expected);
  });
});

describe("initializeDeviceFamilies", () => {
  const all = { Desktop: true, Mobile: false, Xbox: false, Holographic: false };

  test.each([
    ["未設定", undefined, all, ["Desktop", "Mobile", "Xbox", "Holographic"]],
    ["null", null, all, ["Desktop", "Mobile", "Xbox", "Holographic"]],
    ["空のオブジェクト", {}, all, ["Desktop", "Mobile", "Xbox", "Holographic"]],
    ["配列は無効", [], all, ["Desktop", "Mobile", "Xbox", "Holographic"]],
    [
      "一部だけ（入っている真偽値は変えない。Desktop が false でも true にしない）",
      { Desktop: false, Mobile: true },
      { Desktop: false, Mobile: true, Xbox: false, Holographic: false },
      ["Xbox", "Holographic"],
    ],
    [
      "真偽値でない値は初期化する",
      { Desktop: "yes", Mobile: null, Xbox: 1, Holographic: {} },
      all,
      ["Desktop", "Mobile", "Xbox", "Holographic"],
    ],
    [
      "すべて真偽値なら変えない。必須ではない項目（Team など）も保つ",
      { ...all, Mobile: true, Team: true, IoT: false },
      { ...all, Mobile: true, Team: true, IoT: false },
      [],
    ],
  ])("%s", (_name, families, expected, initialized) => {
    const submission = { ...base(), allowTargetFutureDeviceFamilies: families };
    const result = initializeDeviceFamilies(submission);
    expect(result.map((r) => r.family)).toEqual(initialized);
    expect(submission.allowTargetFutureDeviceFamilies).toEqual(
      initialized.length === 0 ? families : expected,
    );
  });

  test("初期化した項目に、前の値と後の値を持たせる", () => {
    const submission = {
      ...base(),
      allowTargetFutureDeviceFamilies: { Mobile: "x" },
    };
    expect(initializeDeviceFamilies(submission)).toEqual([
      { family: "Desktop", before: undefined, after: true },
      { family: "Mobile", before: "x", after: false },
      { family: "Xbox", before: undefined, after: false },
      { family: "Holographic", before: undefined, after: false },
    ]);
  });
});

describe("describePlan", () => {
  test("変更が無ければその旨を返す", () => {
    expect(describePlan({ submission: base(), changes: [], uploads: [] })).toBe(
      "変更はありません。",
    );
  });

  test("表の区切りの縦線を、値の中でエスケープする", () => {
    const text = describePlan({
      submission: base(),
      changes: [
        {
          scope: "ja-jp",
          field: "title",
          kind: "set",
          before: "a|b",
          after: "c",
        },
      ],
      uploads: [],
    });
    expect(text).toContain("a\\|b");
    expect(text.split("\n")).toHaveLength(3);
  });
});
