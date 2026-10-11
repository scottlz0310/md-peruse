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
export const USAGE_QUERY_NAME = "md-peruse usage-daily v1";

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
  const found = await deps.client.get<ListResponse<QueryItem>>(
    `ScheduledQueries?queryName=${encodeURIComponent(USAGE_QUERY_NAME)}&includeSystemQueries=false`,
  );
  const existing = found?.value?.find((item) => item.name === USAGE_QUERY_NAME);
  if (existing) return { queryId: existing.queryId, reused: true };

  const created = await deps.client.post<ListResponse<QueryItem>>(
    "ScheduledQueries",
    {
      name: USAGE_QUERY_NAME,
      description: "md-peruse UsageDaily（直近 3 か月・日次）",
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
  deps.evidence?.json("execution-pending", sanitizeExecutions(pending?.value));
  throw new Error(
    `レポートが完了しませんでした（${maxPolls} 回、約 ${Math.round((maxPolls * interval) / 60000)} 分）。reportId=${reportId}`,
  );
}

function sanitizeExecutions(items: ExecutionItem[] | undefined) {
  return (items ?? []).map(
    ({ reportAccessSecureLink: _link, ...rest }) => rest,
  );
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

  const stamp = deps.now().toISOString().slice(0, 10);
  const created = await deps.client.post<ListResponse<ReportItem>>(
    "ScheduledReport",
    {
      reportName: `md-peruse usage-daily once ${stamp}`,
      description: "md-peruse UsageDaily の 1 回きりの取得（権限と列の確認）",
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
  deps.evidence?.json("execution", sanitizeExecutions([execution])[0]);
  if (!execution.reportAccessSecureLink) {
    throw new Error(
      `完了した実行にダウンロードのリンクがありません（reportId=${reportId}）`,
    );
  }

  const csv = await deps.client.downloadText(execution.reportAccessSecureLink);
  deps.saveFile?.("usage-daily.csv", csv);
  const summary = summarizeUsageCsv(csv);
  deps.evidence?.json("usage-summary", summary);
  deps.log(
    `CSV を取得しました（${summary.rows} 行、版: ${summary.byVersion.map((v) => v.packageVersion).join(", ") || "なし"}）`,
  );
  return summary;
}
