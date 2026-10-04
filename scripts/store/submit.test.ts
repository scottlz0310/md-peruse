import { describe, expect, test } from "bun:test";
import type { StoreApplication, StoreSubmission } from "./plan";
import { type RunDeps, type RunOptions, run } from "./submit";

const norm = (path: string) => path.replaceAll("\\", "/");

const CSV = [
  "Field,ID,Type,default,ja-jp,en-us",
  "Title,4,t,,md-peruse,md-peruse",
  "Description,2,t,,新しい説明,New description",
  "DesktopScreenshot1,100,p,,store/ja1.png,store/en1.png",
  "DesktopScreenshotCaption1,150,t,,日本語の字幕,English caption",
  "",
].join("\r\n");

function published(): StoreSubmission {
  return {
    id: "pub1",
    targetPublishMode: "Manual",
    listings: {
      "ja-jp": {
        baseListing: {
          title: "md-peruse",
          description: "旧",
          images: [
            {
              fileName: "o.png",
              fileStatus: "Uploaded",
              id: "1",
              imageType: "Screenshot",
            },
          ],
        },
      },
      "en-us": {
        baseListing: { title: "md-peruse", description: "Old", images: [] },
      },
    },
    applicationPackages: [
      {
        fileName: "old.msixupload",
        fileStatus: "Uploaded",
        minimumDirectXVersion: "None",
        minimumSystemRam: "None",
      },
    ],
  };
}

interface Setup {
  deps: RunDeps;
  /** 証跡として保存された、(名前, 内容) の列。 */
  records: Array<[string, unknown]>;
  calls: string[];
  put: StoreSubmission[];
  uploads: Uint8Array[];
  logs: string[];
}

function setup(
  overrides: {
    app?: Partial<StoreApplication>;
    published?: StoreSubmission;
    created?: StoreSubmission;
    statuses?: string[];
  } = {},
): Setup {
  const calls: string[] = [];
  const put: StoreSubmission[] = [];
  const uploads: Uint8Array[] = [];
  const logs: string[] = [];
  const records: Array<[string, unknown]> = [];
  const statuses = [...(overrides.statuses ?? ["PreProcessing"])];

  const files = new Map<string, Uint8Array>([
    ["docs/assets/store/ja1.png", new Uint8Array([1])],
    ["docs/assets/store/en1.png", new Uint8Array([2])],
    ["pkg/new.msixupload", new Uint8Array([9, 9])],
  ]);

  const deps: RunDeps = {
    evidence: {
      json: (name, data) => {
        records.push([name, data]);
      },
    },
    client: {
      getApplication: async () => {
        calls.push("getApplication");
        return {
          id: "app",
          lastPublishedApplicationSubmission: { id: "pub1" },
          ...overrides.app,
        };
      },
      getSubmission: async () => {
        calls.push("getSubmission");
        return structuredClone(overrides.published ?? published());
      },
      createSubmission: async () => {
        calls.push("createSubmission");
        return {
          ...structuredClone(overrides.created ?? published()),
          id: "new1",
          fileUploadUrl: "https://blob.example/x?sig=SECRET",
        };
      },
      updateSubmission: async (submission) => {
        calls.push("updateSubmission");
        put.push(submission);
        return { ...structuredClone(submission), status: "PendingCommit" };
      },
      uploadZip: async (_url, zip) => {
        calls.push("uploadZip");
        uploads.push(zip);
      },
      commit: async () => {
        calls.push("commit");
        return { status: "CommitStarted" };
      },
      getStatus: async () => {
        calls.push("getStatus");
        return { status: statuses.shift() ?? "PreProcessing" };
      },
    },
    readText: (path) => {
      if (norm(path) !== "docs/assets/store/listingData.csv") {
        throw new Error(`想定外のテキストの読み込み: ${path}`);
      }
      return CSV;
    },
    readBytes: (path) => {
      const bytes = files.get(norm(path));
      if (!bytes) throw new Error(`想定外のファイルの読み込み: ${path}`);
      return bytes;
    },
    sleep: async () => {},
    log: (message) => logs.push(message),
  };
  return { deps, records, calls, put, uploads, logs };
}

const listing: RunOptions = {
  listingDir: "docs/assets/store",
  languages: ["ja-jp", "en-us"],
  replaceScreenshots: false,
  publishMode: "Manual",
  apply: false,
  commit: true,
  cloneOnly: false,
};

describe("dry-run（既定）", () => {
  test("読み取りだけを行い、変更の計画を返す", async () => {
    const s = setup();
    const result = await run(listing, s.deps);
    expect(result.mode).toBe("dry-run");
    expect(s.calls).toEqual(["getApplication", "getSubmission"]);
    expect(result.plan.changes.map((c) => `${c.scope}:${c.field}`)).toEqual([
      "ja-jp:description",
      "en-us:description",
    ]);
  });

  test("画像の差し替えも計画に出すが、アップロードはしない", async () => {
    const s = setup();
    const result = await run({ ...listing, replaceScreenshots: true }, s.deps);
    expect(result.plan.uploads).toHaveLength(2);
    expect(s.calls).toEqual(["getApplication", "getSubmission"]);
  });
});

describe("--clone-only", () => {
  test("申請を作るだけで、更新も commit もしない。変更が無くても作る", async () => {
    const same = published();
    (
      same.listings["ja-jp"] as { baseListing: Record<string, unknown> }
    ).baseListing.description = "新しい説明";
    (
      same.listings["en-us"] as { baseListing: Record<string, unknown> }
    ).baseListing.description = "New description";
    const s = setup({ published: same, created: same });
    const result = await run(
      { ...listing, apply: true, cloneOnly: true },
      s.deps,
    );
    expect(result).toMatchObject({ mode: "cloned", submissionId: "new1" });
    expect(s.calls).toEqual([
      "getApplication",
      "getSubmission",
      "createSubmission",
    ]);
  });

  test("複製に違いがあっても、止めずに違いを表示する（確認が目的）", async () => {
    const s = setup({
      published: { ...published(), pricing: { trialPeriod: "NoFreeTrial" } },
      created: { ...published(), pricing: { trialPeriod: "Unknown" } },
    });
    const result = await run(
      { ...listing, apply: true, cloneOnly: true },
      s.deps,
    );
    expect(result.mode).toBe("cloned");
    const log = s.logs.join("\n");
    expect(log).toContain("違い（トップレベル）: pricing");
    expect(log).toContain('価格（作成した申請）: {"trialPeriod":"Unknown"}');
  });

  test("--apply が無ければ、申請を作らずに止める", async () => {
    const s = setup();
    await expect(run({ ...listing, cloneOnly: true }, s.deps)).rejects.toThrow(
      "--clone-only は申請（下書き）を作るので、--apply が必要です",
    );
    expect(s.calls).toEqual([]);
  });

  test("作成した申請の公開方法が期待と違えば、止める", async () => {
    const s = setup({
      created: { ...published(), targetPublishMode: "Immediate" },
    });
    await expect(
      run({ ...listing, apply: true, cloneOnly: true }, s.deps),
    ).rejects.toThrow("申請: Immediate、期待: Manual");
  });
});

describe("事前チェック", () => {
  test("処理中の申請があれば、申請を読む前に止まる", async () => {
    const s = setup({ app: { pendingApplicationSubmission: { id: "p9" } } });
    await expect(run(listing, s.deps)).rejects.toThrow(
      "処理中の申請が残っています",
    );
    expect(s.calls).toEqual(["getApplication"]);
  });

  test("公開済みの申請が無ければ止まる", async () => {
    const s = setup({ app: { lastPublishedApplicationSubmission: undefined } });
    await expect(run(listing, s.deps)).rejects.toThrow(
      "公開済みの申請が見つかりません",
    );
  });

  test("公開方法が期待と違えば、apply でも申請を作らない", async () => {
    const immediate = { ...published(), targetPublishMode: "Immediate" };
    const s = setup({ published: immediate });
    await expect(run({ ...listing, apply: true }, s.deps)).rejects.toThrow(
      "申請: Immediate、期待: Manual",
    );
    expect(s.calls).not.toContain("createSubmission");
  });

  test("作成した申請の公開方法が期待と違えば、更新しない", async () => {
    const s = setup({
      created: { ...published(), targetPublishMode: "Immediate" },
    });
    await expect(run({ ...listing, apply: true }, s.deps)).rejects.toThrow(
      "申請: Immediate、期待: Manual",
    );
    expect(s.calls).not.toContain("updateSubmission");
  });

  test("自動公開（Immediate）を期待すれば、Immediate の申請を扱える", async () => {
    const immediate = { ...published(), targetPublishMode: "Immediate" };
    const s = setup({ published: immediate, created: immediate });
    const result = await run(
      { ...listing, publishMode: "Immediate", apply: true },
      s.deps,
    );
    expect(result.mode).toBe("applied");
    expect(s.put[0]?.targetPublishMode).toBe("Immediate");
  });

  test("自動公開を期待しているのに申請が Manual なら、止める", async () => {
    const s = setup();
    await expect(
      run({ ...listing, publishMode: "Immediate" }, s.deps),
    ).rejects.toThrow("申請: Manual、期待: Immediate");
  });

  test.each([
    [
      "listing も package も無い",
      { listingDir: undefined },
      "--listing か --package",
    ],
    [
      "画像の差し替えに listing が無い",
      {
        listingDir: undefined,
        packagePath: "pkg/new.msixupload",
        replaceScreenshots: true,
      },
      "--replace-screenshots には --listing",
    ],
  ])("引数が不正: %s", async (_name, patch, message) => {
    await expect(run({ ...listing, ...patch }, setup().deps)).rejects.toThrow(
      message,
    );
  });
});

describe("apply", () => {
  test("文章だけの更新: 作成 → 更新 → commit。ZIP は送らない", async () => {
    const s = setup();
    const result = await run({ ...listing, apply: true }, s.deps);
    expect(s.calls).toEqual([
      "getApplication",
      "getSubmission",
      "createSubmission",
      "updateSubmission",
      "commit",
      "getStatus",
    ]);
    expect(result).toMatchObject({
      mode: "applied",
      submissionId: "new1",
      status: "PreProcessing",
    });
    expect(s.put[0]?.listings["ja-jp"]?.baseListing.description).toBe(
      "新しい説明",
    );
  });

  test("デバイス ファミリーが未初期化なら、初期化して PUT し、ログに残す", async () => {
    const s = setup();
    await run({ ...listing, apply: true }, s.deps);
    expect(s.put[0]?.allowTargetFutureDeviceFamilies).toEqual({
      Desktop: true,
      Mobile: false,
      Xbox: false,
      Holographic: false,
    });
    const log = s.logs.join("\n");
    expect(log).toContain("デバイス ファミリー（作成した申請）: null");
    expect(log).toContain(
      "allowTargetFutureDeviceFamilies.Desktop を初期化しました: null → true",
    );
  });

  test("デバイス ファミリーが初期化済みなら、値を変えず、初期化のログも出さない", async () => {
    const families = {
      Desktop: false,
      Mobile: true,
      Xbox: false,
      Holographic: false,
      Team: true,
    };
    const created = {
      ...published(),
      allowTargetFutureDeviceFamilies: families,
    };
    const s = setup({
      published: { ...published(), allowTargetFutureDeviceFamilies: families },
      created,
    });
    await run({ ...listing, apply: true }, s.deps);
    expect(s.put[0]?.allowTargetFutureDeviceFamilies).toEqual(families);
    expect(s.logs.join("\n")).not.toContain("を初期化しました");
  });

  test("デバイス ファミリーの初期化は、変更の一覧（計画）に含めない", async () => {
    const s = setup();
    const result = await run({ ...listing, apply: true }, s.deps);
    expect(
      result.plan.changes.some((c) => c.field.includes("allowTarget")),
    ).toBe(false);
  });

  test("画像の差し替え: 更新の後、commit の前に ZIP を送る", async () => {
    const s = setup();
    await run({ ...listing, apply: true, replaceScreenshots: true }, s.deps);
    expect(s.calls).toEqual([
      "getApplication",
      "getSubmission",
      "createSubmission",
      "updateSubmission",
      "uploadZip",
      "commit",
      "getStatus",
    ]);
    // ZIP のローカル ヘッダーの印（PK\x03\x04）で始まる。
    expect(Array.from(s.uploads[0]?.slice(0, 4) ?? [])).toEqual([
      0x50, 0x4b, 0x03, 0x04,
    ]);
  });

  test("パッケージの差し替え: ZIP に入れて送る", async () => {
    const s = setup();
    await run(
      {
        ...listing,
        listingDir: undefined,
        packagePath: "pkg/new.msixupload",
        apply: true,
      },
      s.deps,
    );
    expect(s.calls).toContain("uploadZip");
    const packages = s.put[0]?.applicationPackages ?? [];
    expect(packages.map((p) => [p.fileName, p.fileStatus])).toEqual([
      ["old.msixupload", "PendingDelete"],
      ["new.msixupload", "PendingUpload"],
    ]);
  });

  test("変更が無ければ、申請（下書き）を作らない", async () => {
    const same = published();
    (
      same.listings["ja-jp"] as { baseListing: Record<string, unknown> }
    ).baseListing.description = "新しい説明";
    (
      same.listings["en-us"] as { baseListing: Record<string, unknown> }
    ).baseListing.description = "New description";
    const s = setup({ published: same });
    const result = await run({ ...listing, apply: true }, s.deps);
    expect(result.mode).toBe("no-changes");
    expect(s.calls).toEqual(["getApplication", "getSubmission"]);
  });

  test("--no-commit なら、commit せずに下書きのまま止める", async () => {
    const s = setup();
    const result = await run(
      { ...listing, apply: true, commit: false },
      s.deps,
    );
    expect(s.calls).not.toContain("commit");
    expect(result.submissionId).toBe("new1");
    expect(s.logs.join("\n")).toContain("下書きのまま");
  });

  test("commit に失敗したら例外にする", async () => {
    const s = setup({ statuses: ["CommitFailed"] });
    await expect(run({ ...listing, apply: true }, s.deps)).rejects.toThrow(
      "commit に失敗しました（申請 new1）",
    );
  });

  test("作成した申請が公開済みの内容と違えば、更新せずに止める", async () => {
    const different = published();
    (
      different.listings["ja-jp"] as { baseListing: Record<string, unknown> }
    ).baseListing.description = "新しい説明";
    const s = setup({ created: different });
    await expect(run({ ...listing, apply: true }, s.deps)).rejects.toThrow(
      "公開済みの申請の複製ではありません（違う項目: listings）",
    );
    expect(s.calls).not.toContain("updateSubmission");
  });

  test("扱わない項目（価格）が複製で変わっていても、更新せずに止める", async () => {
    const s = setup({
      published: { ...published(), pricing: { trialPeriod: "NoFreeTrial" } },
      created: { ...published(), pricing: { trialPeriod: "Unknown" } },
    });
    await expect(run({ ...listing, apply: true }, s.deps)).rejects.toThrow(
      "違う項目: pricing",
    );
    expect(s.calls).not.toContain("updateSubmission");
    expect(s.calls).not.toContain("commit");
  });

  test("申請ごとに変わる項目（id など）の違いは、複製として許す", async () => {
    const s = setup();
    const result = await run({ ...listing, apply: true }, s.deps);
    expect(result.mode).toBe("applied");
    expect(s.logs.join("\n")).toContain("違い（トップレベル）: なし");
  });

  test("アップロード先が無ければ、ZIP を送らずに止める", async () => {
    const s = setup();
    const create = s.deps.client.createSubmission;
    s.deps.client.createSubmission = async () => ({
      ...(await create()),
      fileUploadUrl: undefined,
    });
    await expect(
      run({ ...listing, apply: true, replaceScreenshots: true }, s.deps),
    ).rejects.toThrow("fileUploadUrl がありません");
    expect(s.calls).not.toContain("commit");
  });

  test("ログに、署名つきのアップロード URL を出さない", async () => {
    const s = setup();
    await run({ ...listing, apply: true, replaceScreenshots: true }, s.deps);
    expect(s.logs.join("\n")).not.toContain("SECRET");
  });
});

describe("証跡", () => {
  const names = (s: Setup) => s.records.map(([name]) => name);

  test("dry-run は、読み取った内容と計画を残す", async () => {
    const s = setup();
    await run(listing, s.deps);
    expect(names(s)).toEqual([
      "01-application",
      "02-published-submission",
      "03-plan",
    ]);
  });

  test("文章だけの更新は、申請の JSON、PUT の本文と応答、commit、状態を、順に残す", async () => {
    const s = setup();
    await run({ ...listing, apply: true }, s.deps);
    expect(names(s)).toEqual([
      "01-application",
      "02-published-submission",
      "03-plan",
      "04-created-submission",
      "05-put-request",
      "06-put-response",
      "08-commit-response",
      "09-status",
    ]);
  });

  test("画像の差し替えは、ZIP の大きさと中身の一覧（バイト数）も残す", async () => {
    const s = setup();
    await run({ ...listing, apply: true, replaceScreenshots: true }, s.deps);
    const upload = s.records.find(([name]) => name === "07-upload")?.[1] as {
      zipBytes: number;
      files: Array<{ name: string; bytes: number }>;
    };
    expect(upload.zipBytes).toBeGreaterThan(0);
    expect(upload.files.map((f) => f.name)).toEqual([
      "images/ja-jp/01-ja1.png",
      "images/en-us/01-en1.png",
    ]);
    const plan = s.records.find(([name]) => name === "03-plan")?.[1] as {
      uploads: Array<{ name: string; bytes: number }>;
    };
    expect(plan.uploads).toHaveLength(2);
  });

  test("PUT の応答を、そのまま残す", async () => {
    const s = setup();
    await run({ ...listing, apply: true }, s.deps);
    const response = s.records.find(
      ([name]) => name === "06-put-response",
    )?.[1] as {
      status: string;
    };
    expect(response.status).toBe("PendingCommit");
  });

  test("PUT が失敗しても、送った本文（05-put-request）は残る", async () => {
    const s = setup();
    s.deps.client.updateSubmission = async () => {
      throw new Error("PUT が拒否された");
    };
    await expect(run({ ...listing, apply: true }, s.deps)).rejects.toThrow(
      "PUT が拒否された",
    );
    expect(names(s)).toContain("05-put-request");
    expect(names(s)).not.toContain("06-put-response");
  });

  test("clone-only は、作成した申請までを残す", async () => {
    const s = setup();
    await run({ ...listing, apply: true, cloneOnly: true }, s.deps);
    expect(names(s)).toEqual([
      "01-application",
      "02-published-submission",
      "03-plan",
      "04-created-submission",
    ]);
  });

  test("証跡の保存先が無くても動く", async () => {
    const s = setup();
    const result = await run(
      { ...listing, apply: true },
      { ...s.deps, evidence: undefined },
    );
    expect(result.mode).toBe("applied");
  });
});
