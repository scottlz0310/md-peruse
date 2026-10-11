// Insights API で、1 回きりのレポート（`executeNow`）を作り、CSV を取得する。
//
// 継続収集の設計の前提を、実データで確かめるための最小の経路: ①問い合わせ（`ScheduledQueries`）を、同じ名前が
// あれば再利用して作る、②レポートを今すぐ 1 回実行する（予約・繰り返しは作らない）、③完了を待つ、④署名つき
// URL から CSV を取得する。Partner Center の「My reports」に、問い合わせとレポートが 1 件ずつ残る。
// 署名つき URL は、メッセージにも記録にも出さない（`StoreClient.downloadText` と `redact.ts`）。

import { StoreApiError, type StoreClient } from "./client";
import { parseCsv } from "./csv";
import type { Evidence } from "./evidence";
import type { InsightsDataset } from "./insights";

/** 問い合わせの名前。列や条件を変えたら、版の数字を上げる（同じ名前は再利用するため）。 */
// 問い合わせ名は「英数字と空白のみ」（HTTP 400 の本文で確認。run 38182126939）。
// レポート名・説明は資料に制約の記載が無いため、同じ文字種に揃える。
export const USAGE_QUERY_NAME = "md peruse usage daily v1";

interface ListResponse<T> {
  value?: T[];
}

interface QueryItem {
  queryId: string;
  name?: string;
}

interface ReportItem {
  reportId: string;
}

interface ExecutionItem {
  executionId?: string;
  executionStatus?: string;
  reportAccessSecureLink?: string;
  reportGeneratedTime?: string;
}

export function buildUsageDailyQuery(
  productId: string,
  columns: readonly string[],
): string {
  return `SELECT ${columns.join(", ")} FROM UsageDaily WHERE ProductId IN ('${productId}') TIMESPAN LAST_3_MONTHS AGGREGATED Daily`;
}

export interface VersionSummary {
  packageVersion: string;
  rows: number;
  firstDate: string;
  lastDate: string;
  sessions: number;
}

export interface UsageCsvSummary {
  rows: number;
  columns: string[];
  byVersion: VersionSummary[];
  markets: string[];
}

/** 版別の行数・日付の範囲・セッション数。必要な列が無ければ、足りない列の名前で例外にする。 */
export function summarizeUsageCsv(text: string): UsageCsvSummary {
  const table = parseCsv(text).filter((row) => row.some((cell) => cell !== ""));
  const header = table[0];
  if (!header) throw new Error("レポートの CSV が空です");
  const index = (name: string) => header.indexOf(name);
  const required = ["PackageVersion", "Date", "DailySessionCount", "Market"];
  const missing = required.filter((name) => index(name) < 0);
  if (missing.length > 0) {
    throw new Error(
      `レポートの CSV に列がありません: ${missing.join(", ")}（列: ${header.join(", ")}）`,
    );
  }
  const [iVersion, iDate, iSessions, iMarket] = required.map(index) as [
    number,
    number,
    number,
    number,
  ];

  const byVersion = new Map<string, VersionSummary>();
  const markets = new Set<string>();
  for (const row of table.slice(1)) {
    const version = row[iVersion] ?? "";
    const date = row[iDate] ?? "";
    const entry = byVersion.get(version) ?? {
      packageVersion: version,
      rows: 0,
      firstDate: date,
      lastDate: date,
      sessions: 0,
    };
    entry.rows += 1;
    if (date < entry.firstDate) entry.firstDate = date;
    if (date > entry.lastDate) entry.lastDate = date;
    entry.sessions += Number(row[iSessions] ?? 0) || 0;
    byVersion.set(version, entry);
    markets.add(row[iMarket] ?? "");
  }
  return {
    rows: table.length - 1,
    columns: header,
    byVersion: [...byVersion.values()].sort((a, b) =>
      a.packageVersion.localeCompare(b.packageVersion),
    ),
    markets: [...markets].sort(),
  };
}

export function usageSummaryMarkdown(summary: UsageCsvSummary): string {
  const rows = summary.byVersion.map(
    (v) =>
      `| ${v.packageVersion || "（空）"} | ${v.rows} | ${v.firstDate} 〜 ${v.lastDate} | ${v.sessions} |`,
  );
  return [
    "## Insights API: UsageDaily（直近 3 か月・日次）",
    "",
    `行数: ${summary.rows}、市場: ${summary.markets.join(", ") || "なし"}`,
    "",
    "| PackageVersion | 行数 | 日付の範囲 | DailySessionCount の合計 |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export interface UsageOnceDeps {
  client: Pick<StoreClient, "get" | "post" | "downloadText">;
  productId: string;
  evidence?: Evidence;
  /** CSV などのファイルを、証跡のフォルダーへ書く。 */
  saveFile?: (name: string, text: string) => void;
  log: (message: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** 完了の確認の間隔（ミリ秒）と、最大の回数。 */
  pollIntervalMs?: number;
  maxPolls?: number;
}

async function findOrCreateQuery(
  deps: UsageOnceDeps,
  query: string,
): Promise<{ queryId: string; reused: boolean }> {
  // 条件に合う問い合わせが無いとき、この API は空の一覧ではなく 404 を返す（run 38135221072 で確認）。
  const found = await deps.client
    .get<ListResponse<QueryItem>>(
      `ScheduledQueries?queryName=${encodeURIComponent(USAGE_QUERY_NAME)}&includeSystemQueries=false`,
    )
    .catch((error) => {
      if (error instanceof StoreApiError && error.httpStatus === 404) {
        return undefined;
      }
      throw error;
    });
  const existing = found?.value?.find((item) => item.name === USAGE_QUERY_NAME);
  if (existing) return { queryId: existing.queryId, reused: true };

  const created = await deps.client.post<ListResponse<QueryItem>>(
    "ScheduledQueries",
    {
      name: USAGE_QUERY_NAME,
      description: "md peruse UsageDaily last 3 months daily",
      query,
    },
  );
  const queryId = created?.value?.[0]?.queryId;
  if (!queryId) {
    throw new Error("ScheduledQueries の応答に queryId がありません");
  }
  return { queryId, reused: false };
}

/** 最初の実行が終わるまで、実行の一覧は 404 を返す（資料の注記）。404 は「まだ」として待つ。 */
async function waitForExecution(
  deps: UsageOnceDeps,
  reportId: string,
): Promise<ExecutionItem> {
  const interval = deps.pollIntervalMs ?? 15_000;
  const maxPolls = deps.maxPolls ?? 40;
  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    try {
      const response = await deps.client.get<ListResponse<ExecutionItem>>(
        `ScheduledReport/execution/${reportId}`,
      );
      const item = response?.value?.[0];
      if (item?.executionStatus === "Completed") return item;
      deps.log(
        `実行の状態: ${item?.executionStatus ?? "不明"}（${attempt}/${maxPolls}）`,
      );
    } catch (error) {
      if (!(error instanceof StoreApiError) || error.httpStatus !== 404) {
        throw error;
      }
      deps.log(`実行はまだありません（${attempt}/${maxPolls}）`);
    }
    if (attempt < maxPolls) await deps.sleep(interval);
  }
  // 完了しなかった理由を調べられるよう、保留中の実行を証跡に残してから止まる。
  const pending = await deps.client
    .get<ListResponse<ExecutionItem>>(
      `ScheduledReport/execution/${reportId}?executionStatus=Pending`,
    )
    .catch(() => undefined);
  deps.evidence?.json("execution-pending", redactLinks(pending?.value ?? []));
  throw new Error(
    `レポートが完了しませんでした（${maxPolls} 回、約 ${Math.round((maxPolls * interval) / 60000)} 分）。reportId=${reportId}`,
  );
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

export async function runUsageOnce(
  deps: UsageOnceDeps,
): Promise<UsageCsvSummary> {
  const datasets =
    await deps.client.get<ListResponse<InsightsDataset>>("ScheduledDataset");
  const usage = datasets?.value?.find((d) => d.datasetName === "UsageDaily");
  if (!usage?.selectableColumns?.length) {
    throw new Error("ScheduledDataset に UsageDaily の列がありません");
  }

  const query = buildUsageDailyQuery(deps.productId, usage.selectableColumns);
  deps.evidence?.json("query", { name: USAGE_QUERY_NAME, query });
  const { queryId, reused } = await findOrCreateQuery(deps, query);
  deps.log(
    `問い合わせ: ${reused ? "既存を再利用" : "新規に作成"}（${queryId}）`,
  );

  const stamp = deps.now().toISOString().slice(0, 10).replaceAll("-", "");
  const created = await deps.client.post<ListResponse<ReportItem>>(
    "ScheduledReport",
    {
      reportName: `md peruse usage daily once ${stamp}`,
      description:
        "md peruse UsageDaily one time fetch to check access and columns",
      queryId,
      executeNow: true,
    },
  );
  const reportId = created?.value?.[0]?.reportId;
  if (!reportId) {
    throw new Error("ScheduledReport の応答に reportId がありません");
  }
  deps.log(`レポートを作成しました（${reportId}）`);
  deps.evidence?.json("report", { reportId, queryId });

  const execution = await waitForExecution(deps, reportId);
  deps.evidence?.json("execution", redactLinks(execution));
  if (!execution.reportAccessSecureLink) {
    throw new Error(
      `完了した実行にダウンロードのリンクがありません（reportId=${reportId}）`,
    );
  }

  return downloadUsageCsv(deps, execution.reportAccessSecureLink);
}

async function downloadUsageCsv(
  deps: Pick<UsageOnceDeps, "evidence" | "saveFile" | "log"> & {
    client: Pick<StoreClient, "downloadText">;
  },
  link: string,
): Promise<UsageCsvSummary> {
  const csv = await deps.client.downloadText(link);
  deps.saveFile?.("usage-daily.csv", csv);
  const summary = summarizeUsageCsv(csv);
  deps.evidence?.json("usage-summary", summary);
  deps.log(
    `CSV を取得しました（${summary.rows} 行、版: ${summary.byVersion.map((v) => v.packageVersion).join(", ") || "なし"}）`,
  );
  return summary;
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
  client: Pick<StoreClient, "get" | "downloadText">;
  reportId: string;
  evidence?: Evidence;
  saveFile?: (name: string, text: string) => void;
  log: (message: string) => void;
}

export interface UsageStatusResult {
  probes: ExecutionProbe[];
  /** 完了した実行があり、CSV を取得できたときだけ。 */
  csv?: UsageCsvSummary;
}

async function probeExecutions(
  deps: UsageStatusDeps,
  status: string | undefined,
): Promise<{ probe: ExecutionProbe; items: ExecutionItem[] }> {
  const path = `ScheduledReport/execution/${deps.reportId}${status ? `?executionStatus=${status}` : ""}`;
  try {
    const body = await deps.client.get<ListResponse<ExecutionItem>>(path);
    const items = body?.value ?? [];
    return {
      probe: {
        status,
        httpStatus: 200,
        body: redactLinks(body),
        executions: items.map((item) => ({
          executionStatus: item.executionStatus,
        })),
      },
      items,
    };
  } catch (error) {
    if (!(error instanceof StoreApiError)) throw error;
    // その状態の実行が無いとき、実行の一覧は 404 を返す（資料の注記）。404 以外（状態名の誤りの 400 を含む）は、握りつぶさず伝える。
    if (error.httpStatus !== 404) throw error;
    return {
      probe: {
        status,
        httpStatus: error.httpStatus,
        executions: [],
        error: error.responseBody ?? error.message,
      },
      items: [],
    };
  }
}

/** 既存のレポートの実行の状態だけを見直す。新しいレポートは作らない。完了していれば CSV も取得する。 */
export async function runUsageStatus(
  deps: UsageStatusDeps,
): Promise<UsageStatusResult> {
  const probes: ExecutionProbe[] = [];
  const completed: ExecutionItem[] = [];
  for (const status of [undefined, ...EXECUTION_STATUSES]) {
    const { probe, items } = await probeExecutions(deps, status);
    probes.push(probe);
    deps.log(
      `状態 ${status ?? "（指定なし）"}: HTTP ${probe.httpStatus}、実行 ${probe.executions.length} 件${probe.executions.length > 0 ? `（${probe.executions.map((e) => e.executionStatus ?? "不明").join(", ")}）` : ""}`,
    );
    completed.push(
      ...items.filter(
        (item) =>
          item.executionStatus === "Completed" && item.reportAccessSecureLink,
      ),
    );
  }
  deps.evidence?.json("execution-status", probes);

  const link = completed[0]?.reportAccessSecureLink;
  if (!link) {
    deps.log(`完了した実行はありません（reportId=${deps.reportId}）`);
    return { probes };
  }
  return { probes, csv: await downloadUsageCsv(deps, link) };
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
    result.csv
      ? `完了した実行から CSV を取得した（${result.csv.rows} 行）。`
      : "完了した実行はない。",
    "",
  ].join("\n");
}
