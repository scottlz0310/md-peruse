// Partner Center の Insights API（アプリとゲームの分析データのプログラム用 API）の調査。
//
// 読み取りだけで、レポートの作成・予約・ダウンロードはしない。`ScheduledDataset`（Get Datasets）の応答を
// 証跡に残し、どのデータセットとどの列が取れるかを確かめる。SDK のカスタムイベントを返すデータセットが
// あるか、版別・日別の標準 Sessions（`UsageDaily`）が取れるかが、継続収集の設計の前提になる。
// 認証は申請の API と同じ Entra ID のアプリ（resource も同じ）。資料: Make your first API call
// （https://learn.microsoft.com/en-us/partner-center/insights/apps-games-make-your-first-api-call）。

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { StoreClient } from "./client";
import { createEvidence, type Evidence, reportFailure } from "./evidence";
import {
  runUsageOnce,
  runUsageStatus,
  usageStatusMarkdown,
  usageSummaryMarkdown,
} from "./insights-report";
import { redactText } from "./redact";

export const MODES: readonly string[] = [
  "datasets",
  "usage-once",
  "usage-status",
];

export const INSIGHTS_BASE_URL =
  "https://manage.devcenter.microsoft.com/consumer/insights/v1.1";

/** Get Datasets の応答の、1 件分。使う項目だけを型にする。 */
export interface InsightsDataset {
  datasetName: string;
  selectableColumns?: string[];
  availableMetrics?: string[];
  availableDateRanges?: string[];
  aggregationToDateRangeMapping?: Record<string, string>;
  minimumRecurrenceInterval?: number;
}

interface DatasetsResponse {
  value?: InsightsDataset[];
}

/** カスタムイベントを含みうる、名前や列の手がかり（大文字小文字を区別しない）。 */
const CUSTOM_EVENT_HINT = /custom.?event|customevent|eventname|event_name/i;

export interface DatasetSummary {
  datasetName: string;
  columnCount: number;
  metricCount: number;
  dateRanges: string[];
  minimumRecurrenceInterval?: number;
  /** 名前・列・指標のいずれかが、カスタムイベントの手がかりに合う。 */
  customEventHint: boolean;
  hasPackageVersion: boolean;
}

export function summarizeDatasets(
  datasets: readonly InsightsDataset[],
): DatasetSummary[] {
  return datasets.map((dataset) => {
    const columns = dataset.selectableColumns ?? [];
    const metrics = dataset.availableMetrics ?? [];
    return {
      datasetName: dataset.datasetName,
      columnCount: columns.length,
      metricCount: metrics.length,
      dateRanges: dataset.availableDateRanges ?? [],
      minimumRecurrenceInterval: dataset.minimumRecurrenceInterval,
      customEventHint: [dataset.datasetName, ...columns, ...metrics].some(
        (name) => CUSTOM_EVENT_HINT.test(name),
      ),
      hasPackageVersion: columns.some(
        (name) => name.toLowerCase() === "packageversion",
      ),
    };
  });
}

export function summaryMarkdown(summaries: readonly DatasetSummary[]): string {
  const rows = summaries.map(
    (s) =>
      `| ${s.datasetName} | ${s.columnCount} | ${s.metricCount} | ${s.hasPackageVersion ? "あり" : "なし"} | ${s.customEventHint ? "あり" : "なし"} | ${s.dateRanges.join(", ")} |`,
  );
  return [
    "## Insights API: 取得できるデータセット",
    "",
    `データセット数: ${summaries.length}`,
    "",
    "| データセット | 列 | 指標 | PackageVersion 列 | カスタムイベントの手がかり | 期間 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "「手がかり」は、名前に custom event / event name を含むかの機械的な判定。内容の判断は、証跡の `datasets.json` の列で行う。",
    "",
  ].join("\n");
}

export interface InsightsDeps {
  client: Pick<StoreClient, "get">;
  evidence?: Evidence;
  log: (message: string) => void;
}

export async function run(deps: InsightsDeps): Promise<DatasetSummary[]> {
  const response = await deps.client.get<DatasetsResponse>("ScheduledDataset");
  const datasets = response?.value;
  if (!datasets) {
    throw new Error("ScheduledDataset の応答に value がありません");
  }
  const summaries = summarizeDatasets(datasets);
  deps.evidence?.json("datasets", datasets);
  deps.evidence?.json("summary", summaries);
  deps.log(`データセット ${summaries.length} 件を取得しました`);
  for (const s of summaries) {
    deps.log(
      `  ${s.datasetName}: 列 ${s.columnCount}、PackageVersion ${s.hasPackageVersion ? "あり" : "なし"}、カスタムイベントの手がかり ${s.customEventHint ? "あり" : "なし"}`,
    );
  }
  return summaries;
}

function requiredEnv(env: NodeJS.ProcessEnv, names: string[]): string[] {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`環境変数が未設定です: ${missing.join(", ")}`);
  }
  return names.map((name) => env[name] as string);
}

if (import.meta.main) {
  let evidence: Evidence | undefined;
  let evidenceDir: string | undefined;
  let mode = "datasets";
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const secrets = [
    process.env.AZURE_AD_APPLICATION_SECRET,
    process.env.AZURE_AD_TENANT_ID,
    process.env.AZURE_AD_APPLICATION_CLIENT_ID,
  ];

  try {
    const { values } = parseArgs({
      options: {
        "evidence-dir": { type: "string" },
        mode: { type: "string", default: "datasets" },
        "report-id": { type: "string" },
      },
    });
    mode = values.mode as string;
    if (!MODES.includes(mode)) {
      throw new Error(
        `--mode は ${MODES.join(" か ")} を指定してください: ${mode}`,
      );
    }
    evidenceDir = values["evidence-dir"];
    if (evidenceDir) {
      evidence = createEvidence({
        dir: evidenceDir,
        fs: {
          mkdir: (dir) => mkdirSync(dir, { recursive: true }),
          write: (path, text) => writeFileSync(path, text),
          append: (path, text) => appendFileSync(path, text),
        },
        now: () => new Date(),
        secrets,
      });
    }
    const log = (message: string) => {
      const safe = redactText(message, secrets);
      console.log(safe);
      evidence?.line(safe);
    };

    const [appId, tenantId, clientId, clientSecret] = requiredEnv(process.env, [
      "STORE_PRODUCT_ID",
      "AZURE_AD_TENANT_ID",
      "AZURE_AD_APPLICATION_CLIENT_ID",
      "AZURE_AD_APPLICATION_SECRET",
    ]) as [string, string, string, string];

    const client = new StoreClient({
      fetch: (input, init) => fetch(input, init),
      appId,
      tenantId,
      clientId,
      clientSecret,
      baseUrl: INSIGHTS_BASE_URL,
      trace: (line) => log(`[trace] ${line}`),
    });

    const saveFile = evidenceDir
      ? (name: string, text: string) =>
          writeFileSync(join(evidenceDir as string, name), text)
      : undefined;

    if (mode === "usage-status") {
      const reportId = values["report-id"];
      if (!reportId) {
        throw new Error("--mode usage-status には --report-id が必要です");
      }
      const result = await runUsageStatus({
        client,
        reportId,
        evidence,
        saveFile,
        log,
      });
      if (summary) appendFileSync(summary, usageStatusMarkdown(result));
    } else if (mode === "usage-once") {
      const usage = await runUsageOnce({
        client,
        productId: appId,
        evidence,
        saveFile,
        log,
        sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
        now: () => new Date(),
      });
      if (summary) appendFileSync(summary, usageSummaryMarkdown(usage));
    } else {
      const summaries = await run({ evidence, client, log });
      if (summary) appendFileSync(summary, summaryMarkdown(summaries));
    }
  } catch (error) {
    reportFailure(
      error,
      {
        stderr: (text) => console.error(text),
        appendSummary: summary
          ? (text) => appendFileSync(summary, text)
          : undefined,
        evidence,
      },
      {
        mode: `insights-${mode}`,
        runId: process.env.GITHUB_RUN_ID,
        evidenceDir,
        secrets,
      },
    );
    process.exit(1);
  }
}
