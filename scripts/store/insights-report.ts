// Insights API のレポート（`ScheduledQuery` / `ScheduledReport`）の、作成と実行の状態の確認。
//
// 繰り返し実行するレポートを 1 件作り（`usage-schedule`）、その実行の状態を見直す（`usage-status`）。
// 日別の利用統計（CSV）の取得と保存は、`usage-archive.ts` が行う。日別の値は、公開の artifact・ログ・
// Step Summary に出さない（このリポジトリは公開のため）。
// 署名つき URL は、メッセージにも記録にも出さない（`StoreClient.downloadText` と `redact.ts`）。

import { StoreApiError, type StoreClient } from "./client";
import type { Evidence } from "./evidence";
import type { InsightsDataset } from "./insights";

export interface ListResponse<T> {
  value?: T[];
}

interface QueryItem {
  queryId: string;
  name?: string;
}

interface ReportItem {
  reportId: string;
}

export interface ExecutionItem {
  executionId?: string;
  executionStatus?: string;
  reportAccessSecureLink?: string;
  reportGeneratedTime?: string;
}

/** `UsageDaily`（日次）で選べる期間（`ScheduledDataset` の `aggregationToDateRangeMapping`）。 */
export type UsageTimespan = "LAST_30_DAYS" | "LAST_3_MONTHS";

export function buildUsageDailyQuery(
  productId: string,
  columns: readonly string[],
  timespan: UsageTimespan = "LAST_3_MONTHS",
): string {
  return `SELECT ${columns.join(", ")} FROM UsageDaily WHERE ProductId IN ('${productId}') TIMESPAN ${timespan} AGGREGATED Daily`;
}

interface QuerySpec {
  /** 英数字と空白だけ（API が、それ以外を 400 で拒否する）。 */
  name: string;
  description: string;
  query: string;
}

async function findOrCreateQuery(
  deps: { client: Pick<StoreClient, "get" | "post"> },
  spec: QuerySpec,
): Promise<{ queryId: string; reused: boolean }> {
  // 条件に合う問い合わせが無いとき、この API は空の一覧ではなく 404 を返す（run 38135221072 で確認）。
  const found = await deps.client
    .get<ListResponse<QueryItem>>(
      `ScheduledQueries?queryName=${encodeURIComponent(spec.name)}&includeSystemQueries=false`,
    )
    .catch((error) => {
      if (error instanceof StoreApiError && error.httpStatus === 404) {
        return undefined;
      }
      throw error;
    });
  const existing = found?.value?.find((item) => item.name === spec.name);
  if (existing) return { queryId: existing.queryId, reused: true };

  const created = await deps.client.post<ListResponse<QueryItem>>(
    "ScheduledQueries",
    spec,
  );
  const queryId = created?.value?.[0]?.queryId;
  if (!queryId) {
    throw new Error("ScheduledQueries の応答に queryId がありません");
  }
  return { queryId, reused: false };
}

const LINK_KEY = /link|location|url/i;

/** 署名つき URL を含みうる値（キー名に link / location / url を含む文字列）を、証跡に出さない。キーは残す。 */
function redactLinks(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLinks);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        LINK_KEY.test(key) && typeof inner === "string"
          ? "[省略]"
          : redactLinks(inner),
      ]),
    );
  }
  return value;
}

/** 繰り返しの検証用の問い合わせ（直近 30 日・日次）。条件を変えたら、版の数字を上げる（同じ名前は再利用するため）。 */
export const USAGE_SCHEDULE_QUERY_NAME = "md peruse usage daily 30 days v1";
const USAGE_SCHEDULE_REPORT_NAME = "md peruse usage daily scheduled";
/** 検証のため、日次で 3 回だけ実行する。3 回で自然に終わり、Partner Center に繰り返しが残り続けない。 */
const SCHEDULE_INTERVAL_HOURS = 24;
const SCHEDULE_COUNT = 3;
/**
 * 開始までの猶予。API は「開始は、現在の UTC から 4 時間以上先」を求める（HTTP 400。run 38192254358）。
 * 承認から実行までの時間と時刻のずれに備えて、10 分の余裕を足す。
 */
const SCHEDULE_START_DELAY_MS = (4 * 60 + 10) * 60 * 1000;

export interface UsageScheduleDeps {
  client: Pick<StoreClient, "get" | "post">;
  productId: string;
  evidence?: Evidence;
  log: (message: string) => void;
  now: () => Date;
}

export interface UsageScheduleResult {
  reportId: string;
  queryId: string;
  startTime: string;
  recurrenceInterval: number;
  recurrenceCount: number;
}

/**
 * UsageDaily（直近 30 日・日次）を、Partner Center に繰り返し実行させるレポートを 1 件作る。作成は 1 回だけで、
 * 以後の取得は `usage-status`（最新の `Completed` の実行を取る）で行う。繰り返しが成立するか（範囲の制約、
 * 実行が積まれるか）を確かめるための検証で、レポートは `SCHEDULE_COUNT` 回で終わる。
 */
export async function runUsageSchedule(
  deps: UsageScheduleDeps,
): Promise<UsageScheduleResult> {
  const datasets =
    await deps.client.get<ListResponse<InsightsDataset>>("ScheduledDataset");
  const usage = datasets?.value?.find((d) => d.datasetName === "UsageDaily");
  if (!usage?.selectableColumns?.length) {
    throw new Error("ScheduledDataset に UsageDaily の列がありません");
  }
  // 期間と間隔は、データセットの宣言で確かめる。宣言が無ければ、満たさないものとして伝える。
  if (!usage.availableDateRanges?.includes("LAST_30_DAYS")) {
    throw new Error(
      `UsageDaily で LAST_30_DAYS を選べません（選べる期間: ${usage.availableDateRanges?.join(", ") ?? "宣言なし"}）`,
    );
  }
  const minimum = usage.minimumRecurrenceInterval;
  if (minimum === undefined || SCHEDULE_INTERVAL_HOURS < minimum) {
    throw new Error(
      `UsageDaily の最小の繰り返し間隔（${minimum ?? "宣言なし"} 時間）が、${SCHEDULE_INTERVAL_HOURS} 時間の間隔を満たしません`,
    );
  }

  const query = buildUsageDailyQuery(
    deps.productId,
    usage.selectableColumns,
    "LAST_30_DAYS",
  );
  deps.evidence?.json("query", { name: USAGE_SCHEDULE_QUERY_NAME, query });
  const { queryId, reused } = await findOrCreateQuery(deps, {
    name: USAGE_SCHEDULE_QUERY_NAME,
    description: "md peruse UsageDaily last 30 days daily",
    query,
  });
  deps.log(
    `問い合わせ: ${reused ? "既存を再利用" : "新規に作成"}（${queryId}）`,
  );

  // 資料の形式は yyyy-MM-ddTHH:mm:ssZ（ミリ秒なし）。
  const startTime = new Date(deps.now().getTime() + SCHEDULE_START_DELAY_MS)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const created = await deps.client.post<ListResponse<ReportItem>>(
    "ScheduledReport",
    {
      reportName: USAGE_SCHEDULE_REPORT_NAME,
      description: "md peruse UsageDaily scheduled daily to check recurrence",
      queryId,
      startTime,
      recurrenceInterval: SCHEDULE_INTERVAL_HOURS,
      recurrenceCount: SCHEDULE_COUNT,
      format: "csv",
    },
  );
  deps.evidence?.json("schedule", redactLinks(created));
  const reportId = created?.value?.[0]?.reportId;
  if (!reportId) {
    throw new Error("ScheduledReport の応答に reportId がありません");
  }
  deps.log(
    `繰り返しのレポートを作成しました（${reportId}。開始 ${startTime}、${SCHEDULE_INTERVAL_HOURS} 時間ごとに ${SCHEDULE_COUNT} 回）`,
  );
  return {
    reportId,
    queryId,
    startTime,
    recurrenceInterval: SCHEDULE_INTERVAL_HOURS,
    recurrenceCount: SCHEDULE_COUNT,
  };
}

export function usageScheduleMarkdown(result: UsageScheduleResult): string {
  return [
    "## Insights API: 繰り返しのレポートを作成した",
    "",
    "| 項目 | 値 |",
    "| --- | --- |",
    `| reportId | ${result.reportId} |`,
    `| queryId | ${result.queryId} |`,
    `| 開始（UTC） | ${result.startTime} |`,
    `| 間隔 | ${result.recurrenceInterval} 時間ごと |`,
    `| 回数 | ${result.recurrenceCount} |`,
    "",
    "実行の状態は、`mode=usage-status` の `report_id` に、この reportId を指定して確かめる。",
    "",
  ].join("\n");
}

// `executionStatus` の有効な値（Get report executions API の資料。
// https://learn.microsoft.com/en-us/partner-center/insights/apps-games-programmatic-access-paradigm）。
// 指定しないと `Completed` の最新 1 件だけが返り、完了前は 404 になる。実行中（`Running`）などは、状態を指定しないと見えない。
const EXECUTION_STATUSES = [
  "Pending",
  "Running",
  "Paused",
  "Failed",
  "Completed",
];

export interface ExecutionProbe {
  /** 状態の指定（指定なしは undefined）。 */
  status?: string;
  httpStatus: number;
  /** 応答の本文（署名つき URL は取り除いてある）。 */
  body?: unknown;
  executions: Array<{ executionStatus?: string }>;
  error?: string;
}

export interface UsageStatusDeps {
  client: Pick<StoreClient, "get">;
  reportId: string;
  evidence?: Evidence;
  log: (message: string) => void;
}

export interface UsageStatusResult {
  probes: ExecutionProbe[];
  /** 状態 `Completed` の実行の件数（取得は `usage-archive.ts`）。 */
  completed: number;
}

async function probeExecutions(
  deps: UsageStatusDeps,
  status: string | undefined,
): Promise<ExecutionProbe> {
  const path = `ScheduledReport/execution/${deps.reportId}${status ? `?executionStatus=${status}` : ""}`;
  try {
    const body = await deps.client.get<ListResponse<ExecutionItem>>(path);
    return {
      status,
      httpStatus: 200,
      body: redactLinks(body),
      executions: (body?.value ?? []).map((item) => ({
        executionStatus: item.executionStatus,
      })),
    };
  } catch (error) {
    if (!(error instanceof StoreApiError)) throw error;
    // その状態の実行が無いとき、実行の一覧は 404 を返す（資料の注記）。404 以外（状態名の誤りの 400 を含む）は、握りつぶさず伝える。
    if (error.httpStatus !== 404) throw error;
    return {
      status,
      httpStatus: error.httpStatus,
      executions: [],
      error: error.responseBody ?? error.message,
    };
  }
}

/** 既存のレポートの実行の状態だけを見直す。新しいレポートは作らず、CSV は取得しない（日別の値を公開の記録に出さないため）。 */
export async function runUsageStatus(
  deps: UsageStatusDeps,
): Promise<UsageStatusResult> {
  const probes: ExecutionProbe[] = [];
  for (const status of [undefined, ...EXECUTION_STATUSES]) {
    const probe = await probeExecutions(deps, status);
    probes.push(probe);
    deps.log(
      `状態 ${status ?? "（指定なし）"}: HTTP ${probe.httpStatus}、実行 ${probe.executions.length} 件${probe.executions.length > 0 ? `（${probe.executions.map((e) => e.executionStatus ?? "不明").join(", ")}）` : ""}`,
    );
  }
  deps.evidence?.json("execution-status", probes);

  const completed =
    probes.find((p) => p.status === "Completed")?.executions.length ?? 0;
  deps.log(
    completed > 0
      ? `完了した実行: ${completed} 件（reportId=${deps.reportId}）`
      : `完了した実行はありません（reportId=${deps.reportId}）`,
  );
  return { probes, completed };
}

export function usageStatusMarkdown(result: UsageStatusResult): string {
  const rows = result.probes.map(
    (p) =>
      `| ${p.status ?? "（指定なし）"} | ${p.httpStatus} | ${p.executions.length} | ${p.executions.map((e) => e.executionStatus ?? "不明").join(", ")} |`,
  );
  return [
    "## Insights API: レポートの実行の状態",
    "",
    "| 状態の指定 | HTTP | 実行の件数 | 実行の状態 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    result.completed > 0
      ? `完了した実行: ${result.completed} 件。`
      : "完了した実行はない。",
    "",
  ].join("\n");
}
