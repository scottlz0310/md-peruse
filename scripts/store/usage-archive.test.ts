import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type FetchLike, StoreClient } from "./client";
import { createEvidence, reportFailure } from "./evidence";
import {
  inspectUsageCsv,
  runUsageArchive,
  snapshotName,
  usageArchiveMarkdown,
} from "./usage-archive";

const SECRET = "s3cr3t-value";
const TOKEN_URL = "https://login.example/tenant-1/oauth2/token";
const BASE = "https://api.example/consumer/insights/v1.1";
const SAS = "https://blob.example/report.csv?sv=1&sig=SIGNATURE-VALUE";
const EXECUTIONS_URL = `${BASE}/ScheduledReport/execution/rep-1?executionStatus=Completed`;

// 実際の CSV の形（run 38190395495）。日別の値（DailySessionCount）は、公開の記録に出さない。
const CSV_HEADER =
  "ProductId,SubscriptionName,DeviceType,PackageVersion,Market,Date,DailySessionCount";
const CSV = [
  CSV_HEADER,
  "9P35BW61FN4W,All,All,0.1.1.0,All,2026-10-08,8123",
  "9P35BW61FN4W,null,PC,0.1.1.0,JP,2026-10-08,8123",
  "9P35BW61FN4W,All,All,0.2.1.0,All,2026-10-10,3456",
  "",
].join("\r\n");

const execution = (id: string, generated: string) => ({
  executionId: id,
  executionStatus: "Completed",
  reportAccessSecureLink: SAS,
  reportGeneratedTime: generated,
});

const completed = (...items: unknown[]) => ({
  status: 200,
  body: { value: items },
});

function setup(options: {
  executions?: { status: number; body?: unknown };
  downloadStatus?: number;
  csv?: string;
  /** Dropbox にもともとあるファイル（パス → 内容）。 */
  files?: Record<string, string>;
}) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${input}`);
    if (input === TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: "tok-1" }));
    }
    if (input === EXECUTIONS_URL) {
      const entry = options.executions ?? { status: 404, body: {} };
      return new Response(JSON.stringify(entry.body ?? {}), {
        status: entry.status,
      });
    }
    if (input === SAS) {
      return options.downloadStatus
        ? new Response(`denied ${SECRET}`, { status: options.downloadStatus })
        : new Response(options.csv ?? CSV);
    }
    throw new Error(`想定外の呼び出し: ${input}`);
  };
  const client = new StoreClient({
    fetch: fetchFn,
    tenantId: "tenant-1",
    clientId: "client-1",
    clientSecret: SECRET,
    appId: "9P35BW61FN4W",
    baseUrl: BASE,
    tokenUrl: TOKEN_URL,
    readOnly: true,
  });
  const uploads: Array<{ path: string; text: string }> = [];
  const dropboxFiles: Record<string, string> = { ...options.files };
  const written: Record<string, string> = {};
  const logs: string[] = [];
  const evidence = createEvidence({
    dir: "ev",
    fs: {
      mkdir: () => {},
      write: (path, text) => {
        written[path] = text;
      },
      append: (path, text) => {
        written[path] = (written[path] ?? "") + text;
      },
    },
    now: () => new Date("2026-10-12T00:00:00Z"),
    secrets: [SECRET],
  });
  const deps = {
    client,
    dropbox: {
      upload: async (path: string, text: string) => {
        uploads.push({ path, text });
        dropboxFiles[path] = text;
        return { path, size: text.length };
      },
      download: async (path: string) => dropboxFiles[path],
    },
    reportId: "rep-1",
    evidence,
    log: (message: string) => logs.push(message),
    now: () => new Date("2026-10-12T09:00:00Z"),
  };
  return { deps, calls, uploads, written, logs, dropboxFiles };
}

describe("inspectUsageCsv", () => {
  test("値は読まず、行数と日付の範囲だけを返す（CRLF・末尾の空行）", () => {
    expect(inspectUsageCsv(CSV)).toEqual({
      rows: 3,
      firstDate: "2026-10-08",
      lastDate: "2026-10-10",
    });
  });

  test("行が無い（見出しだけ）の CSV は、0 行として扱う", () => {
    expect(inspectUsageCsv(`${CSV_HEADER}\r\n`)).toEqual({
      rows: 0,
      firstDate: undefined,
      lastDate: undefined,
    });
  });

  test.each([
    {
      name: "空の CSV",
      csv: "",
      message: "レポートの CSV が空です",
    },
    {
      name: "必要な列が無ければ、足りない列と実際の列を示す",
      csv: "ProductId,Date\r\n9P35BW61FN4W,2026-10-08\r\n",
      message:
        "レポートの CSV に列がありません: PackageVersion, DailySessionCount",
    },
  ])("$name は、原因が分かる例外にする", ({ csv, message }) => {
    expect(() => inspectUsageCsv(csv)).toThrow(message);
  });
});

describe("snapshotName", () => {
  test.each([
    {
      input: "2026-10-11T23:42:19Z",
      expected: "usage-daily_20261011T234219Z.csv",
    },
    {
      input: "2026-10-11T23:42:19.123Z",
      expected: "usage-daily_20261011T234219Z.csv",
    },
  ])("$input → $expected", ({ input, expected }) => {
    expect(snapshotName(input)).toBe(expected);
  });

  test.each(["2026-10-11 23:42:19", "2026-10-11", "", "../../x"])(
    "形が違う値（%p）は、保存先を決められないので例外にする",
    (input) => {
      expect(() => snapshotName(input)).toThrow(
        "reportGeneratedTime の形が想定と違います",
      );
    },
  );
});

describe("runUsageArchive", () => {
  test("最新の完了した実行の CSV を、原本のまま Dropbox の snapshots へ保存する", async () => {
    const { deps, uploads, calls } = setup({
      executions: completed(
        execution("e1", "2026-10-10T23:40:00Z"),
        execution("e2", "2026-10-11T23:42:19Z"),
      ),
    });

    const result = await runUsageArchive(deps);

    // 正本（生スナップショット）を先に書き、そのあとで写し（統合した CSV と概観）を書く。
    expect(uploads.map((u) => u.path)).toEqual([
      "/usage-daily/snapshots/usage-daily_20261011T234219Z.csv",
      "/usage-daily/merged.csv",
      "/usage-daily/overview.md",
    ]);
    expect(uploads[0]?.text).toBe(CSV);
    expect(result).toMatchObject({
      reportId: "rep-1",
      executionId: "e2",
      reportGeneratedTime: "2026-10-11T23:42:19Z",
      dropboxPath: "/usage-daily/snapshots/usage-daily_20261011T234219Z.csv",
      rows: 3,
      firstDate: "2026-10-08",
      lastDate: "2026-10-10",
      merged: { path: "/usage-daily/merged.csv", rows: 3, added: 3 },
      overviewPath: "/usage-daily/overview.md",
    });
    // Partner Center へは、トークンの取得以外の POST をしない（読み取り専用）。
    expect(calls.filter((c) => c.startsWith("POST "))).toEqual([
      `POST ${TOKEN_URL}`,
    ]);
  });

  test("同じ実行を 2 回保存しても、同じ名前になる（冪等）", async () => {
    const executions = completed(execution("e2", "2026-10-11T23:42:19Z"));
    const first = setup({ executions });
    const second = setup({ executions });
    await runUsageArchive(first.deps);
    await runUsageArchive(second.deps);
    expect(first.uploads[0]?.path).toBe(second.uploads[0]?.path);
  });

  test("日別の値と署名つき URL は、証跡にもログにも Step Summary にも出さない", async () => {
    const { deps, written, logs } = setup({
      executions: completed(execution("e2", "2026-10-11T23:42:19Z")),
    });
    const result = await runUsageArchive(deps);
    const everything = [
      ...Object.values(written),
      ...logs,
      usageArchiveMarkdown(result),
    ].join("\n");
    for (const forbidden of ["8123", "3456", "SIGNATURE-VALUE", SAS, SECRET]) {
      expect(everything).not.toContain(forbidden);
    }
    expect(written[join("ev", "archive.json")]).toContain("rows");
    expect(usageArchiveMarkdown(result)).toContain(
      "| 日付の範囲 | 2026-10-08 〜 2026-10-10 |",
    );
  });

  test.each([
    {
      name: "実行が 1 件も無い（404）",
      executions: { status: 404, body: {} },
    },
    {
      name: "実行の一覧が空",
      executions: { status: 200, body: { value: [] } },
    },
    {
      name: "完了した実行にリンクが無い",
      executions: completed({
        executionId: "e1",
        executionStatus: "Completed",
        reportGeneratedTime: "2026-10-11T23:42:19Z",
      }),
    },
    {
      name: "完了した実行に生成時刻が無い",
      executions: completed({
        executionId: "e1",
        executionStatus: "Completed",
        reportAccessSecureLink: SAS,
      }),
    },
  ])(
    "$name ときは、保存せずに例外にする（cron の失敗通知で気づく）",
    async ({ executions }) => {
      const { deps, uploads } = setup({ executions });
      await expect(runUsageArchive(deps)).rejects.toThrow(
        "完了した実行がありません（reportId=rep-1）",
      );
      expect(uploads).toHaveLength(0);
    },
  );

  test("404 以外の一覧の失敗は、握りつぶさずに伝える", async () => {
    const { deps, uploads } = setup({ executions: { status: 403, body: {} } });
    const error = await runUsageArchive(deps).catch((e) => e);
    expect((error as Error).message).toContain("HTTP 403");
    expect(uploads).toHaveLength(0);
  });

  test("ダウンロードの失敗は、署名つき URL を含めず、保存もしない", async () => {
    const { deps, uploads } = setup({
      executions: completed(execution("e1", "2026-10-11T23:42:19Z")),
      downloadStatus: 403,
    });
    const error = await runUsageArchive(deps).catch((e) => e);
    expect((error as Error).message).toContain("レポートのダウンロードに失敗");
    expect((error as Error).message).not.toContain("SIGNATURE-VALUE");
    expect((error as Error).message).not.toContain(SECRET);
    expect(uploads).toHaveLength(0);
  });

  test("日別の利用統計の形でない CSV は、保存せずに例外にする", async () => {
    const { deps, uploads } = setup({
      executions: completed(execution("e1", "2026-10-11T23:42:19Z")),
      csv: "<html>error</html>",
    });
    await expect(runUsageArchive(deps)).rejects.toThrow(
      "レポートの CSV に列がありません",
    );
    expect(uploads).toHaveLength(0);
  });

  test.each([
    {
      name: "見出しが欠落している（先頭がデータ行）",
      csv: [
        "9P35BW61FN4W,All,All,0.1.1.0,All,2026-10-08,8123",
        "9P35BW61FN4W,All,All,0.2.1.0,All,2026-10-10,3456",
        "",
      ].join("\r\n"),
    },
    {
      name: "見出しが破損している（列名の代わりに値が並ぶ）",
      csv: [
        "8123,3456,7,0.1.1.0",
        "9P35BW61FN4W,All,All,0.1.1.0,All,2026-10-08,8123",
        "",
      ].join("\r\n"),
    },
  ])(
    "$name CSV の値は、失敗の報告の全ての出口（標準エラー・run.log・error.json・Step Summary）に残さない",
    async ({ csv }) => {
      const { deps, uploads, written } = setup({
        executions: completed(execution("e1", "2026-10-11T23:42:19Z")),
        csv,
      });
      const error = await runUsageArchive(deps).catch((e) => e);
      const stderr: string[] = [];
      const summary: string[] = [];
      reportFailure(
        error,
        {
          stderr: (text) => stderr.push(text),
          appendSummary: (text) => summary.push(text),
          evidence: deps.evidence,
        },
        { mode: "usage-archive", evidenceDir: "ev", secrets: [SECRET] },
      );

      expect(uploads).toHaveLength(0);
      const everything = [
        ...stderr,
        ...summary,
        ...Object.values(written),
      ].join("\n");
      // 足りない既知の列の名前だけを伝える。
      expect(everything).toContain("レポートの CSV に列がありません: ");
      for (const value of ["8123", "3456", "9P35BW61FN4W", "2026-10-08"]) {
        expect(everything).not.toContain(value);
      }
      expect(Object.keys(written).sort()).toEqual([
        join("ev", "error.json"),
        join("ev", "run.log"),
      ]);
    },
  );

  test("Dropbox への書き込みの失敗は、握りつぶさずに伝える", async () => {
    const { deps } = setup({
      executions: completed(execution("e1", "2026-10-11T23:42:19Z")),
    });
    deps.dropbox.upload = async () => {
      throw new Error("Dropbox への書き込みに失敗しました（HTTP 401）");
    };
    await expect(runUsageArchive(deps)).rejects.toThrow("HTTP 401");
  });

  describe("統合した CSV と概観", () => {
    const executions = completed(execution("e1", "2026-10-11T23:42:19Z"));
    // 統合済みの CSV（前回までの分。2026-10-07 の行は、今回の CSV に無い）。
    const MERGED = [
      CSV_HEADER,
      "9P35BW61FN4W,All,All,0.1.1.0,All,2026-10-07,1111",
      "9P35BW61FN4W,All,All,0.1.1.0,All,2026-10-08,7777",
      "",
    ].join("\r\n");

    test("既存の統合 CSV へ、後勝ちで取り込み、概観を作り直す（件数だけを記録に出す）", async () => {
      const { deps, uploads, dropboxFiles, logs, written } = setup({
        executions,
        files: { "/usage-daily/merged.csv": MERGED },
      });

      const result = await runUsageArchive(deps);

      // 2026-10-08 は今回の値（8123）で置き換え、2026-10-07 は残す。
      expect(result.merged).toEqual({
        path: "/usage-daily/merged.csv",
        rows: 4,
        added: 2,
        updated: 1,
        unchanged: 0,
      });
      const merged = dropboxFiles["/usage-daily/merged.csv"] ?? "";
      expect(merged).toContain("2026-10-07,1111");
      expect(merged).toContain("2026-10-08,8123");
      expect(merged).not.toContain("7777");
      // 概観は Dropbox にだけある。値は、公開の記録（ログ・証跡）に出ない。
      expect(dropboxFiles["/usage-daily/overview.md"]).toContain(
        "# 日別の利用統計の概観",
      );
      expect(uploads.map((u) => u.path)).toHaveLength(3);
      const everything = [...logs, ...Object.values(written)].join("\n");
      expect(everything).toContain("追加 2、更新 1、変更なし 0");
      for (const value of ["1111", "7777", "8123", "3456"]) {
        expect(everything).not.toContain(value);
      }
    });

    test("統合した CSV を読めなければ（ファイルが無い以外）、正本は保存したまま、例外にする", async () => {
      const { deps, uploads } = setup({ executions });
      deps.dropbox.download = async () => {
        throw new Error("Dropbox からの読み取りに失敗しました（HTTP 401）");
      };
      await expect(runUsageArchive(deps)).rejects.toThrow("HTTP 401");
      expect(uploads.map((u) => u.path)).toEqual([
        "/usage-daily/snapshots/usage-daily_20261011T234219Z.csv",
      ]);
    });

    test("統合済みの CSV の見出しに重複した列名があれば、行が潰れるので、上書きせず、値を含めずに例外にする", async () => {
      const broken = [
        "Date,PackageVersion,Market,DeviceType,SubscriptionName,DailySessionCount,Date",
        "2026-10-06,All,All,All,All,4777,2026-10-08",
        "2026-10-07,All,All,All,All,4777,2026-10-08",
        "",
      ].join("\r\n");
      const { deps, uploads, dropboxFiles } = setup({
        executions,
        files: { "/usage-daily/merged.csv": broken },
      });
      const error = await runUsageArchive(deps).catch((e) => e);
      expect((error as Error).message).toContain("重複した列名があります");
      expect((error as Error).message).not.toContain("4777");
      // 壊れた既存ファイルは、そのまま残る（概観も作らない）。
      expect(dropboxFiles["/usage-daily/merged.csv"]).toBe(broken);
      expect(uploads.map((u) => u.path)).toEqual([
        "/usage-daily/snapshots/usage-daily_20261011T234219Z.csv",
      ]);
    });

    test("統合済みの CSV が壊れていたら、上書きせず、値を含めずに例外にする", async () => {
      const { deps, uploads } = setup({
        executions,
        files: {
          "/usage-daily/merged.csv":
            "9P35BW61FN4W,All,All,0.1.1.0,All,2026-10-07,5555\r\n",
        },
      });
      const error = await runUsageArchive(deps).catch((e) => e);
      expect((error as Error).message).toContain(
        "日別の利用統計の CSV に列がありません",
      );
      expect((error as Error).message).not.toContain("5555");
      expect(uploads.map((u) => u.path)).toEqual([
        "/usage-daily/snapshots/usage-daily_20261011T234219Z.csv",
      ]);
    });
  });
});
