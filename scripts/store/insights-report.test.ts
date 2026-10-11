import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type FetchLike, StoreClient } from "./client";
import { createEvidence } from "./evidence";
import {
  buildUsageDailyQuery,
  runUsageOnce,
  runUsageStatus,
  summarizeUsageCsv,
  USAGE_QUERY_NAME,
  usageStatusMarkdown,
  usageSummaryMarkdown,
} from "./insights-report";

const SECRET = "s3cr3t-value";
const TOKEN_URL = "https://login.example/tenant-1/oauth2/token";
const BASE = "https://api.example/consumer/insights/v1.1";
const SAS = "https://blob.example/report.csv?sv=1&sig=SIGNATURE-VALUE";
const COLUMNS = [
  "ProductId",
  "PackageVersion",
  "Market",
  "Date",
  "DailySessionCount",
];

const CSV = [
  "ProductId,PackageVersion,Market,Date,DailySessionCount",
  "9P35BW61FN4W,0.1.1.0,JP,2026-10-08,8",
  "9P35BW61FN4W,0.1.1.0,JP,2026-10-09,4",
  "9P35BW61FN4W,0.2.1.0,JP,2026-10-10,3",
  "",
].join("\r\n");

describe("buildUsageDailyQuery", () => {
  test("製品 ID で絞り、直近 3 か月・日次で取る", () => {
    expect(buildUsageDailyQuery("9P35BW61FN4W", COLUMNS)).toBe(
      "SELECT ProductId, PackageVersion, Market, Date, DailySessionCount FROM UsageDaily WHERE ProductId IN ('9P35BW61FN4W') TIMESPAN LAST_3_MONTHS AGGREGATED Daily",
    );
  });
});

describe("summarizeUsageCsv", () => {
  test("版ごとに、行数・日付の範囲・セッション数を数える（CRLF・末尾の空行）", () => {
    const summary = summarizeUsageCsv(CSV);
    expect(summary.rows).toBe(3);
    expect(summary.markets).toEqual(["JP"]);
    expect(summary.byVersion).toEqual([
      {
        packageVersion: "0.1.1.0",
        rows: 2,
        firstDate: "2026-10-08",
        lastDate: "2026-10-09",
        sessions: 12,
      },
      {
        packageVersion: "0.2.1.0",
        rows: 1,
        firstDate: "2026-10-10",
        lastDate: "2026-10-10",
        sessions: 3,
      },
    ]);
  });

  test.each([
    {
      name: "空の CSV は、原因が分かる例外にする",
      csv: "",
      message: "レポートの CSV が空です",
    },
    {
      name: "必要な列が無ければ、足りない列と実際の列を示す",
      csv: "ProductId,Date\r\n9P35BW61FN4W,2026-10-08\r\n",
      message: "PackageVersion, DailySessionCount, Market",
    },
  ])("$name", ({ csv, message }) => {
    expect(() => summarizeUsageCsv(csv)).toThrow(message);
  });

  test("行が無い（見出しだけ）の CSV は、0 行として扱う", () => {
    const summary = summarizeUsageCsv(
      "ProductId,PackageVersion,Market,Date,DailySessionCount\r\n",
    );
    expect(summary.rows).toBe(0);
    expect(usageSummaryMarkdown(summary)).toContain("行数: 0");
  });
});

interface Scenario {
  existingQuery?: boolean;
  /** 問い合わせの検索の応答を、実 API に合わせて差し替える（既定は 200 と一覧）。 */
  queryLookup?: { status: number; body: unknown };
  /** 実行の一覧の応答を、呼び出しの順に返す。足りなければ最後の値を繰り返す。 */
  executions: Array<{ status: number; body?: unknown }>;
  queryResponse?: unknown;
  reportResponse?: unknown;
  downloadStatus?: number;
}

function setup(scenario: Scenario) {
  const calls: string[] = [];
  let executionCalls = 0;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status });

  const fetchFn: FetchLike = async (input, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${input}`);
    if (input === TOKEN_URL) return json({ access_token: "tok-1" });
    if (input === SAS) {
      return scenario.downloadStatus
        ? new Response(`denied ${SECRET}`, { status: scenario.downloadStatus })
        : new Response(CSV);
    }
    if (input === `${BASE}/ScheduledDataset`) {
      return json({
        value: [
          { datasetName: "Installs", selectableColumns: ["X"] },
          { datasetName: "UsageDaily", selectableColumns: COLUMNS },
        ],
      });
    }
    if (input.startsWith(`${BASE}/ScheduledQueries?`)) {
      if (scenario.queryLookup) {
        return json(scenario.queryLookup.body, scenario.queryLookup.status);
      }
      return json({
        value: scenario.existingQuery
          ? [{ queryId: "q-existing", name: USAGE_QUERY_NAME }]
          : [],
      });
    }
    if (input === `${BASE}/ScheduledQueries`) {
      return json(scenario.queryResponse ?? { value: [{ queryId: "q-new" }] });
    }
    if (input === `${BASE}/ScheduledReport`) {
      return json(
        scenario.reportResponse ?? { value: [{ reportId: "rep-1" }] },
      );
    }
    if (input.startsWith(`${BASE}/ScheduledReport/execution/rep-1`)) {
      const entry =
        scenario.executions[
          Math.min(executionCalls, scenario.executions.length - 1)
        ];
      executionCalls += 1;
      return json(entry?.body ?? {}, entry?.status ?? 200);
    }
    throw new Error(`想定外の呼び出し: ${method} ${input}`);
  };

  const client = new StoreClient({
    fetch: fetchFn,
    tenantId: "tenant-1",
    clientId: "client-1",
    clientSecret: SECRET,
    appId: "9P35BW61FN4W",
    baseUrl: BASE,
    tokenUrl: TOKEN_URL,
  });

  const written: Record<string, string> = {};
  const logs: string[] = [];
  const files: Record<string, string> = {};
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
    now: () => new Date("2026-10-11T00:00:00Z"),
    secrets: [SECRET],
  });
  const sleeps: number[] = [];

  const deps = {
    client,
    productId: "9P35BW61FN4W",
    evidence,
    saveFile: (name: string, text: string) => {
      files[name] = text;
    },
    log: (message: string) => logs.push(message),
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    now: () => new Date("2026-10-11T11:00:00Z"),
    pollIntervalMs: 1000,
    maxPolls: 3,
  };
  return { deps, calls, written, logs, files, sleeps };
}

const completed = {
  status: 200,
  body: {
    value: [
      {
        executionId: "e1",
        executionStatus: "Completed",
        reportAccessSecureLink: SAS,
        reportGeneratedTime: "2026-10-11T11:01:00Z",
      },
    ],
  },
};

describe("runUsageOnce", () => {
  test("問い合わせを作り、1 回だけ実行し、完了を待って CSV を取得する（最初の実行の 404 は『まだ』）", async () => {
    const { deps, calls, files, logs, sleeps } = setup({
      executions: [{ status: 404, body: {} }, completed],
    });

    const summary = await runUsageOnce(deps);

    expect(summary.rows).toBe(3);
    // CSV の原本が、そのまま証跡のフォルダーへ渡る。
    expect(files["usage-daily.csv"]).toBe(CSV);
    expect(calls).toContain(`POST ${BASE}/ScheduledQueries`);
    expect(calls).toContain(`POST ${BASE}/ScheduledReport`);
    expect(calls.filter((c) => c.includes("/execution/"))).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
    expect(logs).toContain("問い合わせ: 新規に作成（q-new）");
  });

  test("同じ名前の問い合わせがあれば、作らずに再利用する", async () => {
    const { deps, calls, logs } = setup({
      existingQuery: true,
      executions: [completed],
    });
    await runUsageOnce(deps);
    expect(calls).not.toContain(`POST ${BASE}/ScheduledQueries`);
    expect(logs).toContain("問い合わせ: 既存を再利用（q-existing）");
  });

  test.each([
    {
      name: "実 API は該当なしを 404 で返す（本文つき）。404 は『無い』として作成へ進む",
      queryLookup: {
        status: 404,
        body: {
          value: [],
          totalCount: 0,
          message: "No item found with given filters",
          statusCode: 404,
        },
      },
      created: true,
    },
    {
      name: "404 以外の検索の失敗は、作成へ進まず伝える",
      queryLookup: { status: 403, body: {} },
      created: false,
    },
  ])("問い合わせの検索: $name", async ({ queryLookup, created }) => {
    const { deps, calls } = setup({ queryLookup, executions: [completed] });
    const result = await runUsageOnce(deps).catch((e) => e);
    expect(calls.includes(`POST ${BASE}/ScheduledQueries`)).toBe(created);
    if (created) {
      expect((result as { rows: number }).rows).toBe(3);
    } else {
      expect((result as Error).message).toContain("HTTP 403");
    }
  });

  test("問い合わせ・レポートの名前と説明は、英数字と空白だけにする（API が英数字と空白以外を 400 で拒否する）", async () => {
    const bodies: Array<{ path: string; body: Record<string, unknown> }> = [];
    const { deps } = setup({ executions: [completed] });
    const original = deps.client.post.bind(deps.client);
    deps.client.post = async (path: string, body: unknown) => {
      bodies.push({ path, body: body as Record<string, unknown> });
      return original(path, body);
    };
    await runUsageOnce(deps);
    const fields = bodies.flatMap(({ body }) =>
      [body.name, body.reportName, body.description].filter(
        (value) => value !== undefined,
      ),
    );
    expect(fields).toHaveLength(4);
    for (const value of fields) {
      expect(value).toMatch(/^[A-Za-z0-9 ]+$/);
    }
  });

  test("予約（繰り返し）は作らず、executeNow だけを送る", async () => {
    const bodies: unknown[] = [];
    const { deps } = setup({ executions: [completed] });
    const original = deps.client.post.bind(deps.client);
    deps.client.post = async (path: string, body: unknown) => {
      bodies.push({ path, body });
      return original(path, body);
    };
    await runUsageOnce(deps);
    const report = bodies.find(
      (b) => (b as { path: string }).path === "ScheduledReport",
    ) as { body: Record<string, unknown> };
    expect(report.body.executeNow).toBe(true);
    expect(report.body).not.toHaveProperty("recurrenceInterval");
    expect(report.body).not.toHaveProperty("recurrenceCount");
  });

  test("署名つき URL と資格情報は、証跡にもログにも残さない", async () => {
    const { deps, written, logs } = setup({
      executions: [completed],
      downloadStatus: undefined,
    });
    await runUsageOnce(deps);
    const everything = [...Object.values(written), ...logs].join("\n");
    expect(everything).not.toContain("SIGNATURE-VALUE");
    expect(everything).not.toContain(SAS);
    expect(everything).not.toContain(SECRET);
  });

  test.each([
    {
      name: "問い合わせの応答に queryId が無い",
      scenario: { queryResponse: { value: [] }, executions: [completed] },
      message: "ScheduledQueries の応答に queryId がありません",
    },
    {
      name: "レポートの応答に reportId が無い",
      scenario: { reportResponse: { value: [] }, executions: [completed] },
      message: "ScheduledReport の応答に reportId がありません",
    },
    {
      name: "完了した実行にリンクが無い",
      scenario: {
        executions: [
          {
            status: 200,
            body: { value: [{ executionStatus: "Completed" }] },
          },
        ],
      },
      message: "ダウンロードのリンクがありません",
    },
    {
      name: "完了しないまま回数を使い切る",
      scenario: {
        executions: [
          {
            status: 200,
            body: { value: [{ executionStatus: "Started" }] },
          },
        ],
      },
      message: "レポートが完了しませんでした（3 回",
    },
  ] as Array<{ name: string; scenario: Scenario; message: string }>)(
    "$name は、原因が分かる例外にする",
    async ({ scenario, message }) => {
      const { deps } = setup(scenario);
      await expect(runUsageOnce(deps)).rejects.toThrow(message);
    },
  );

  test("404 以外の HTTP エラーは、待たずに伝える（資格情報は含めない）", async () => {
    const { deps } = setup({ executions: [{ status: 403, body: {} }] });
    const error = await runUsageOnce(deps).catch((e) => e);
    expect((error as Error).message).toContain("HTTP 403");
    expect((error as Error).message).not.toContain(SECRET);
  });

  test("ダウンロードの失敗は、署名つき URL を含めずに伝える", async () => {
    const { deps } = setup({ executions: [completed], downloadStatus: 403 });
    const error = await runUsageOnce(deps).catch((e) => e);
    expect((error as Error).message).toContain("レポートのダウンロードに失敗");
    expect((error as Error).message).not.toContain("SIGNATURE-VALUE");
    expect((error as Error).message).not.toContain(SECRET);
  });
});

/** 実行の一覧の応答を、状態の指定（指定なしは ""）ごとに返す。足りない指定は 404。 */
function setupStatus(
  responses: Record<string, { status: number; body?: unknown }>,
) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${input}`);
    if (input === TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: "tok-1" }));
    }
    if (input === SAS) return new Response(CSV);
    if (input.startsWith(`${BASE}/ScheduledReport/execution/rep-1`)) {
      const key = new URL(input).searchParams.get("executionStatus") ?? "";
      const entry = responses[key] ?? { status: 404, body: {} };
      return new Response(JSON.stringify(entry.body ?? {}), {
        status: entry.status,
      });
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
  });
  const written: Record<string, string> = {};
  const logs: string[] = [];
  const files: Record<string, string> = {};
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
    reportId: "rep-1",
    evidence,
    saveFile: (name: string, text: string) => {
      files[name] = text;
    },
    log: (message: string) => logs.push(message),
  };
  return { deps, calls, written, logs, files };
}

const STATUS_EVIDENCE = join("ev", "execution-status.json");

const pendingExecution = {
  status: 200,
  body: {
    value: [
      {
        executionId: "e1",
        executionStatus: "Pending",
        reportLocation: null,
        reportAccessSecureLink: SAS,
      },
    ],
  },
};

describe("runUsageStatus", () => {
  test("完了した実行があれば、CSV を取得して集計する（署名つき URL は証跡に残さない）", async () => {
    const { deps, written, files } = setupStatus({
      "": completed,
      Completed: completed,
    });
    const result = await runUsageStatus(deps);

    expect(result.csv?.rows).toBe(3);
    expect(files["usage-daily.csv"]).toBe(CSV);
    expect(result.probes.map((p) => p.status)).toEqual([
      undefined,
      "Pending",
      "Started",
      "Completed",
      "Failed",
    ]);
    const everything = Object.values(written).join("\n");
    expect(everything).toContain("[省略]");
    expect(everything).not.toContain("SIGNATURE-VALUE");
    expect(everything).not.toContain(SECRET);
  });

  test("完了した実行が無ければ、CSV を取らずに、状態ごとの応答を残して正常に終わる", async () => {
    const { deps, calls, logs, written } = setupStatus({
      "": { status: 200, body: { value: [] } },
      Pending: pendingExecution,
    });
    const result = await runUsageStatus(deps);

    expect(result.csv).toBeUndefined();
    expect(calls).not.toContain(`GET ${SAS}`);
    expect(logs).toContain("完了した実行はありません（reportId=rep-1）");
    expect(logs).toContain("状態 Pending: HTTP 200、実行 1 件（Pending）");
    const probes = JSON.parse(written[STATUS_EVIDENCE] ?? "[]");
    expect(probes).toHaveLength(5);
    expect(probes[1].executions).toEqual([{ executionStatus: "Pending" }]);
    expect(written[STATUS_EVIDENCE]).not.toContain("SIGNATURE-VALUE");
  });

  test.each([
    {
      name: "状態の指定なしの 404 は『実行なし』として記録して続ける",
      responses: { Pending: pendingExecution, "": { status: 404, body: {} } },
      httpStatuses: [404, 200, 404, 404, 404],
    },
    {
      name: "状態ごとの失敗（400）は、記録して続ける",
      responses: {
        "": { status: 200, body: { value: [] } },
        Started: { status: 400, body: { message: "bad status" } },
      },
      httpStatuses: [200, 404, 400, 404, 404],
    },
  ] as Array<{
    name: string;
    responses: Record<string, { status: number; body?: unknown }>;
    httpStatuses: number[];
  }>)("$name", async ({ responses, httpStatuses }) => {
    const { deps } = setupStatus(responses);
    const result = await runUsageStatus(deps);
    expect(result.probes.map((p) => p.httpStatus)).toEqual(httpStatuses);
    expect(result.csv).toBeUndefined();
  });

  test("状態の指定なしの取得が 404 以外で失敗したら、続けずに伝える", async () => {
    const { deps, calls } = setupStatus({ "": { status: 403, body: {} } });
    const error = await runUsageStatus(deps).catch((e) => e);
    expect((error as Error).message).toContain("HTTP 403");
    expect(calls.filter((c) => c.includes("/execution/"))).toHaveLength(1);
  });

  test("状態の表を、Markdown に出す", async () => {
    const { deps } = setupStatus({ Pending: pendingExecution });
    const markdown = usageStatusMarkdown(await runUsageStatus(deps));
    expect(markdown).toContain("| Pending | 200 | 1 | Pending |");
    expect(markdown).toContain("完了した実行はない。");
  });
});
