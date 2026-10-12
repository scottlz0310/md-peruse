import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type FetchLike, StoreClient } from "./client";
import { createEvidence } from "./evidence";
import {
  buildUsageDailyQuery,
  runUsageSchedule,
  runUsageStatus,
  USAGE_SCHEDULE_QUERY_NAME,
  usageScheduleMarkdown,
  usageStatusMarkdown,
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

describe("buildUsageDailyQuery", () => {
  test("製品 ID で絞り、直近 3 か月・日次で取る", () => {
    expect(buildUsageDailyQuery("9P35BW61FN4W", COLUMNS)).toBe(
      "SELECT ProductId, PackageVersion, Market, Date, DailySessionCount FROM UsageDaily WHERE ProductId IN ('9P35BW61FN4W') TIMESPAN LAST_3_MONTHS AGGREGATED Daily",
    );
  });
});

interface Scenario {
  existingQuery?: boolean;
  /** 問い合わせの検索の応答を、実 API に合わせて差し替える（既定は 200 と一覧）。 */
  queryLookup?: { status: number; body: unknown };
  queryResponse?: unknown;
  reportResponse?: unknown;
  /** `UsageDaily` のデータセットの宣言を、一部差し替える（既定は、実際の宣言と同じ）。 */
  usageDataset?: Record<string, unknown>;
}

function setup(scenario: Scenario = {}) {
  const calls: string[] = [];
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status });

  const fetchFn: FetchLike = async (input, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${input}`);
    if (input === TOKEN_URL) return json({ access_token: "tok-1" });
    if (input === `${BASE}/ScheduledDataset`) {
      return json({
        value: [
          { datasetName: "Installs", selectableColumns: ["X"] },
          {
            datasetName: "UsageDaily",
            selectableColumns: COLUMNS,
            // 実際の宣言（2026-10-11 の Get Datasets）。
            availableDateRanges: ["LAST_30_DAYS", "LAST_3_MONTHS"],
            minimumRecurrenceInterval: 1,
            ...scenario.usageDataset,
          },
        ],
      });
    }
    if (input.startsWith(`${BASE}/ScheduledQueries?`)) {
      if (scenario.queryLookup) {
        return json(scenario.queryLookup.body, scenario.queryLookup.status);
      }
      return json({
        value: scenario.existingQuery
          ? [{ queryId: "q-existing", name: USAGE_SCHEDULE_QUERY_NAME }]
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

  const deps = {
    client,
    productId: "9P35BW61FN4W",
    evidence,
    log: (message: string) => logs.push(message),
    now: () => new Date("2026-10-11T11:00:00Z"),
  };
  return { deps, calls, written, logs };
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

/** Get report executions API の `executionStatus` の有効な値（公式の資料）。 */
const VALID_EXECUTION_STATUSES = [
  "Pending",
  "Running",
  "Paused",
  "Failed",
  "Completed",
];

/**
 * 実行の一覧の応答を、状態の指定（指定なしは ""）ごとに返す。足りない指定は 404。
 * 資料にない状態の名前は、実 API と同じく 400 にする。
 */
function setupStatus(
  responses: Record<string, { status: number; body?: unknown }>,
) {
  const calls: string[] = [];
  const fetchFn: FetchLike = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${input}`);
    if (input === TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: "tok-1" }));
    }
    if (input.startsWith(`${BASE}/ScheduledReport/execution/rep-1`)) {
      const key = new URL(input).searchParams.get("executionStatus") ?? "";
      const invalid = key !== "" && !VALID_EXECUTION_STATUSES.includes(key);
      const entry = invalid
        ? { status: 400, body: { message: `invalid executionStatus ${key}` } }
        : (responses[key] ?? { status: 404, body: {} });
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
    log: (message: string) => logs.push(message),
  };
  return { deps, calls, written, logs };
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

const runningExecution = {
  status: 200,
  body: {
    value: [
      {
        executionId: "e2",
        executionStatus: "Running",
        reportLocation: null,
        reportAccessSecureLink: null,
      },
    ],
  },
};

describe("runUsageSchedule", () => {
  /** POST の本文を、パスごとに集める。 */
  function capturePosts(deps: ReturnType<typeof setup>["deps"]) {
    const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
    const original = deps.client.post.bind(deps.client);
    deps.client.post = async (path: string, body: unknown) => {
      posts.push({ path, body: body as Record<string, unknown> });
      return original(path, body);
    };
    return posts;
  }

  test("直近 30 日の問い合わせを作り、24 時間ごと・3 回の繰り返しのレポートを 1 件作る（予約でなく executeNow を使わない）", async () => {
    const { deps, logs } = setup();
    const posts = capturePosts(deps);

    const result = await runUsageSchedule(deps);

    expect(result).toEqual({
      reportId: "rep-1",
      queryId: "q-new",
      // setup の now（2026-10-11T11:00:00Z）の 4 時間 10 分後（API は 4 時間以上先を求める）。ミリ秒を付けない。
      startTime: "2026-10-11T15:10:00Z",
      recurrenceInterval: 24,
      recurrenceCount: 3,
    });
    const query = posts.find((p) => p.path === "ScheduledQueries");
    expect(String(query?.body.query)).toContain(
      "TIMESPAN LAST_30_DAYS AGGREGATED Daily",
    );
    const report = posts.find((p) => p.path === "ScheduledReport");
    expect(report?.body).toMatchObject({
      queryId: "q-new",
      startTime: "2026-10-11T15:10:00Z",
      recurrenceInterval: 24,
      recurrenceCount: 3,
      format: "csv",
    });
    expect(report?.body).not.toHaveProperty("executeNow");
    expect(logs.join("\n")).toContain(
      "繰り返しのレポートを作成しました（rep-1",
    );
  });

  test("問い合わせ・レポートの名前と説明は、英数字と空白だけにする", async () => {
    const { deps } = setup();
    const posts = capturePosts(deps);
    await runUsageSchedule(deps);
    const fields = posts.flatMap(({ body }) =>
      [body.name, body.reportName, body.description].filter(
        (value) => value !== undefined,
      ),
    );
    expect(fields).toHaveLength(4);
    for (const value of fields) {
      expect(value).toMatch(/^[A-Za-z0-9 ]+$/);
    }
  });

  test.each([
    {
      name: "データセットで LAST_30_DAYS を選べない",
      scenario: { usageDataset: { availableDateRanges: ["LAST_3_MONTHS"] } },
      message:
        "UsageDaily で LAST_30_DAYS を選べません（選べる期間: LAST_3_MONTHS）",
    },
    {
      name: "期間の宣言が無い",
      scenario: { usageDataset: { availableDateRanges: undefined } },
      message: "選べる期間: 宣言なし",
    },
    {
      name: "最小の繰り返し間隔が、24 時間より長い",
      scenario: { usageDataset: { minimumRecurrenceInterval: 48 } },
      message: "最小の繰り返し間隔（48 時間）が、24 時間の間隔を満たしません",
    },
    {
      name: "最小の繰り返し間隔の宣言が無い",
      scenario: { usageDataset: { minimumRecurrenceInterval: undefined } },
      message: "最小の繰り返し間隔（宣言なし 時間）",
    },
    {
      name: "レポートの応答に reportId が無い",
      scenario: { reportResponse: { value: [] } },
      message: "ScheduledReport の応答に reportId がありません",
    },
  ] as Array<{ name: string; scenario: Partial<Scenario>; message: string }>)(
    "$name は、レポートを作らずに（または原因が分かる例外で）止まる",
    async ({ scenario, message }) => {
      const { deps } = setup(scenario);
      const posts = capturePosts(deps);
      await expect(runUsageSchedule(deps)).rejects.toThrow(message);
      // データセットの宣言を満たさないとき、書き込みは起きない。
      if (message !== "ScheduledReport の応答に reportId がありません") {
        expect(posts).toHaveLength(0);
      }
    },
  );

  test("同じ名前の問い合わせがあれば、作らずに再利用する", async () => {
    const { deps, calls, logs } = setup({ existingQuery: true });
    await runUsageSchedule(deps);
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
    const { deps, calls } = setup({ queryLookup });
    const result = await runUsageSchedule(deps).catch((e) => e);
    expect(calls.includes(`POST ${BASE}/ScheduledQueries`)).toBe(created);
    if (created) {
      expect((result as { reportId: string }).reportId).toBe("rep-1");
    } else {
      expect((result as Error).message).toContain("HTTP 403");
    }
  });

  test("Step Summary に、reportId と確認の手順を出す", async () => {
    const { deps } = setup();
    const markdown = usageScheduleMarkdown(await runUsageSchedule(deps));
    expect(markdown).toContain("| reportId | rep-1 |");
    expect(markdown).toContain("| 間隔 | 24 時間ごと |");
    expect(markdown).toContain("`mode=usage-status`");
  });
});

describe("runUsageStatus", () => {
  test("完了した実行があっても、CSV は取得しない（日別の値を公開の記録に出さない。署名つき URL も残さない）", async () => {
    const { deps, calls, logs, written } = setupStatus({
      "": completed,
      Completed: completed,
    });
    const result = await runUsageStatus(deps);

    expect(result.completed).toBe(1);
    expect(calls).not.toContain(`GET ${SAS}`);
    expect(logs).toContain("完了した実行: 1 件（reportId=rep-1）");
    expect(result.probes.map((p) => p.status)).toEqual([
      undefined,
      "Pending",
      "Running",
      "Paused",
      "Failed",
      "Completed",
    ]);
    const everything = Object.values(written).join("\n");
    expect(everything).toContain("[省略]");
    expect(everything).not.toContain("SIGNATURE-VALUE");
    expect(everything).not.toContain(SECRET);
  });

  test("完了した実行が無ければ、状態ごとの応答を残して正常に終わる", async () => {
    const { deps, calls, logs, written } = setupStatus({
      "": { status: 200, body: { value: [] } },
      Pending: pendingExecution,
    });
    const result = await runUsageStatus(deps);

    expect(result.completed).toBe(0);
    expect(calls).not.toContain(`GET ${SAS}`);
    expect(logs).toContain("完了した実行はありません（reportId=rep-1）");
    expect(logs).toContain("状態 Pending: HTTP 200、実行 1 件（Pending）");
    const probes = JSON.parse(written[STATUS_EVIDENCE] ?? "[]");
    expect(probes).toHaveLength(6);
    expect(probes[1].executions).toEqual([{ executionStatus: "Pending" }]);
    expect(written[STATUS_EVIDENCE]).not.toContain("SIGNATURE-VALUE");
  });

  test.each([
    {
      name: "状態の指定なしの 404 は『実行なし』として記録して続ける",
      responses: { Pending: pendingExecution, "": { status: 404, body: {} } },
      httpStatuses: [404, 200, 404, 404, 404, 404],
    },
    {
      name: "状態ごとの 404 は『その状態の実行なし』として記録して続ける",
      responses: {
        "": { status: 200, body: { value: [] } },
        Running: runningExecution,
      },
      httpStatuses: [200, 404, 200, 404, 404, 404],
    },
  ] as Array<{
    name: string;
    responses: Record<string, { status: number; body?: unknown }>;
    httpStatuses: number[];
  }>)("$name", async ({ responses, httpStatuses }) => {
    const { deps } = setupStatus(responses);
    const result = await runUsageStatus(deps);
    expect(result.probes.map((p) => p.httpStatus)).toEqual(httpStatuses);
    expect(result.completed).toBe(0);
  });

  test("実行中（Running）の実行を、証跡と状態表に残す（資料にない Started は取得しない）", async () => {
    const { deps, calls, written } = setupStatus({ Running: runningExecution });
    const result = await runUsageStatus(deps);

    expect(result.completed).toBe(0);
    const probes = JSON.parse(written[STATUS_EVIDENCE] ?? "[]");
    const running = probes.find(
      (p: { status?: string }) => p.status === "Running",
    );
    expect(running.executions).toEqual([{ executionStatus: "Running" }]);
    expect(usageStatusMarkdown(result)).toContain(
      "| Running | 200 | 1 | Running |",
    );
    expect(calls.some((c) => c.includes("executionStatus=Started"))).toBe(
      false,
    );
  });

  test("状態ごとの取得が 404 以外で失敗したら、握りつぶさずに伝える", async () => {
    const { deps } = setupStatus({
      Pending: { status: 400, body: { message: "bad request" } },
    });
    const error = await runUsageStatus(deps).catch((e) => e);
    expect((error as Error).message).toContain("HTTP 400");
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
