import { describe, expect, test } from "bun:test";
import { type FetchLike, StoreApiError, StoreClient } from "./client";
import {
  INSIGHTS_BASE_URL,
  type InsightsDataset,
  run,
  summarizeDatasets,
  summaryMarkdown,
} from "./insights";

const SECRET = "s3cr3t-value";
const TOKEN_URL = "https://login.example/tenant-1/oauth2/token";
const BASE = "https://api.example/consumer/insights/v1.1";

const datasets: InsightsDataset[] = [
  {
    datasetName: "UsageDaily",
    selectableColumns: ["ProductId", "PackageVersion", "Date"],
    availableMetrics: ["DailySessionCount"],
    availableDateRanges: ["LAST_30_DAYS", "LAST_3_MONTHS"],
    minimumRecurrenceInterval: 1,
  },
  {
    datasetName: "Xevents_Metrics",
    selectableColumns: ["EventId", "EventTitle", "ViewCount"],
  },
  {
    datasetName: "CustomEvents",
    selectableColumns: ["EventName", "EventCount"],
  },
  { datasetName: "Installs" },
];

describe("summarizeDatasets", () => {
  test.each([
    {
      name: "PackageVersion 列がある標準 Usage は、カスタムイベントの手がかりなし",
      index: 0,
      hasPackageVersion: true,
      customEventHint: false,
    },
    {
      name: "Xbox のイベント指標（EventTitle など）は、手がかりに数えない",
      index: 1,
      hasPackageVersion: false,
      customEventHint: false,
    },
    {
      name: "データセット名に CustomEvents を含めば、手がかりあり",
      index: 2,
      hasPackageVersion: false,
      customEventHint: true,
    },
    {
      name: "列も指標も無いデータセットも、落ちずに数える",
      index: 3,
      hasPackageVersion: false,
      customEventHint: false,
    },
  ])("$name", ({ index, hasPackageVersion, customEventHint }) => {
    const summary = summarizeDatasets(datasets)[index];
    expect(summary?.hasPackageVersion).toBe(hasPackageVersion);
    expect(summary?.customEventHint).toBe(customEventHint);
  });

  test("列・指標・期間の数を数える", () => {
    expect(summarizeDatasets(datasets)[0]).toMatchObject({
      columnCount: 3,
      metricCount: 1,
      dateRanges: ["LAST_30_DAYS", "LAST_3_MONTHS"],
      minimumRecurrenceInterval: 1,
    });
  });

  test("Step Summary の表に、全データセットが並ぶ", () => {
    const markdown = summaryMarkdown(summarizeDatasets(datasets));
    expect(markdown).toContain("データセット数: 4");
    for (const { datasetName } of datasets) {
      expect(markdown).toContain(`| ${datasetName} |`);
    }
  });
});

describe("run", () => {
  function setup(handler: (url: string) => Response) {
    const urls: string[] = [];
    const fetchFn: FetchLike = async (input) => {
      urls.push(input);
      return handler(input);
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
    return { client, urls };
  }

  const ok = (url: string) =>
    new Response(
      JSON.stringify(
        url === TOKEN_URL ? { access_token: "tok-1" } : { value: datasets },
      ),
    );

  test("ScheduledDataset を GET し、証跡と要約を残す", async () => {
    const { client, urls } = setup(ok);
    const written: Record<string, unknown> = {};
    const logs: string[] = [];

    const summaries = await run({
      client,
      evidence: {
        json: (name, data) => {
          written[name] = data;
        },
        line: () => {},
      },
      log: (message) => logs.push(message),
    });

    expect(urls).toEqual([TOKEN_URL, `${BASE}/ScheduledDataset`]);
    expect(summaries).toHaveLength(4);
    expect(written.datasets).toEqual(datasets);
    expect(logs[0]).toBe("データセット 4 件を取得しました");
  });

  test("既定の base URL は、Insights API の v1.1", () => {
    expect(INSIGHTS_BASE_URL).toBe(
      "https://manage.devcenter.microsoft.com/consumer/insights/v1.1",
    );
  });

  test.each([
    { name: "value が無い応答は、原因が分かる例外にする", body: {} },
    { name: "応答が空でも、同じ例外にする", body: undefined },
  ])("$name", async ({ body }) => {
    const { client } = setup((url) =>
      url === TOKEN_URL
        ? new Response(JSON.stringify({ access_token: "tok-1" }))
        : new Response(body === undefined ? "" : JSON.stringify(body)),
    );
    await expect(run({ client, log: () => {} })).rejects.toThrow(
      "ScheduledDataset の応答に value がありません",
    );
  });

  test("HTTP エラーは握りつぶさず、相関 ID と本文を持つ例外で伝える（資格情報は含めない）", async () => {
    const { client } = setup((url) =>
      url === TOKEN_URL
        ? new Response(JSON.stringify({ access_token: "tok-1" }))
        : new Response(`denied ${SECRET}`, {
            status: 403,
            headers: { "MS-CorrelationId": "corr-1" },
          }),
    );
    const error = await run({ client, log: () => {} }).catch((e) => e);
    expect(error).toBeInstanceOf(StoreApiError);
    expect((error as StoreApiError).httpStatus).toBe(403);
    expect((error as StoreApiError).correlation).toContain("corr-1");
    expect((error as StoreApiError).message).not.toContain(SECRET);
  });
});
