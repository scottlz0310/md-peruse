// Insights API の繰り返しレポートの最新の完了した実行から、日別の利用統計（CSV）を取り、Dropbox へ保存する。
//
// 読み取りだけのジョブ（承認なしの Environment `store-readonly`、`--read-only`）で、毎日動かす。Partner Center
// へは書かない（読み取り専用のクライアントが強制する）。書く先は Dropbox だけ。
//
// このリポジトリは公開で、artifact・ログ・Step Summary は誰でも読める。日別の値（セッション数など）は、
// それらに出さない。公開の記録に残すのは、行数・日付の範囲・サイズ・保存先のパスだけ。
// 保存するファイル名は、実行の生成時刻で決まる。同じ実行を 2 回保存しても、同じ名前を上書きするだけ（冪等）。

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { StoreApiError, StoreClient } from "./client";
import { parseCsv } from "./csv";
import { DropboxClient, type UploadResult } from "./dropbox";
import { createEvidence, type Evidence, reportFailure } from "./evidence";
import { INSIGHTS_BASE_URL } from "./insights";
import type { ExecutionItem, ListResponse } from "./insights-report";
import { redactText } from "./redact";

export const SNAPSHOT_DIR = "/usage-daily/snapshots";

/** 保存の前に、CSV が日別の利用統計の形かを確かめるための必須の列。 */
const REQUIRED_COLUMNS = ["Date", "PackageVersion", "DailySessionCount"];

export interface UsageCsvInfo {
  rows: number;
  firstDate?: string;
  lastDate?: string;
}

/** 値は読まず、行数と日付の範囲だけを返す。必要な列が無ければ、足りない列の名前で例外にする。 */
export function inspectUsageCsv(text: string): UsageCsvInfo {
  const table = parseCsv(text).filter((row) => row.some((cell) => cell !== ""));
  const header = table[0];
  if (!header) throw new Error("レポートの CSV が空です");
  const missing = REQUIRED_COLUMNS.filter((name) => !header.includes(name));
  if (missing.length > 0) {
    // 見出しが欠落・破損していると、`header` は日別のデータ行になる。未検証の内容は、公開の記録へ出る
    // 例外の文に入れない（足りない既知の列の名前だけを伝える）。
    throw new Error(`レポートの CSV に列がありません: ${missing.join(", ")}`);
  }
  const iDate = header.indexOf("Date");
  const dates = table
    .slice(1)
    .map((row) => row[iDate] ?? "")
    .filter((date) => date !== "")
    .sort();
  return {
    rows: table.length - 1,
    firstDate: dates[0],
    lastDate: dates[dates.length - 1],
  };
}

/** `2026-10-11T23:42:19Z` → `20261011T234219Z`。形が違えば、保存先の名前を決められないので例外にする。 */
export function snapshotName(reportGeneratedTime: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(
      reportGeneratedTime,
    );
  if (!match) {
    throw new Error(
      `reportGeneratedTime の形が想定と違います: ${reportGeneratedTime}`,
    );
  }
  return `usage-daily_${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}Z.csv`;
}

export interface UsageArchiveDeps {
  client: Pick<StoreClient, "get" | "downloadText">;
  dropbox: { upload: (path: string, text: string) => Promise<UploadResult> };
  reportId: string;
  evidence?: Evidence;
  log: (message: string) => void;
}

export interface UsageArchiveResult extends UsageCsvInfo {
  reportId: string;
  executionId?: string;
  reportGeneratedTime: string;
  dropboxPath: string;
  bytes: number;
}

/** 最新の完了した実行の CSV を、Dropbox へ保存する。完了した実行が無ければ、例外にする（通知で気づけるように）。 */
export async function runUsageArchive(
  deps: UsageArchiveDeps,
): Promise<UsageArchiveResult> {
  // 実行が 1 件も無いとき、実行の一覧は 404 を返す（資料の注記）。
  const response = await deps.client
    .get<ListResponse<ExecutionItem>>(
      `ScheduledReport/execution/${deps.reportId}?executionStatus=Completed`,
    )
    .catch((error) => {
      if (error instanceof StoreApiError && error.httpStatus === 404) {
        return undefined;
      }
      throw error;
    });
  const latest = (response?.value ?? [])
    .filter(
      (item) =>
        item.executionStatus === "Completed" &&
        item.reportAccessSecureLink &&
        item.reportGeneratedTime,
    )
    .sort((a, b) =>
      (b.reportGeneratedTime ?? "").localeCompare(a.reportGeneratedTime ?? ""),
    )[0];
  if (!latest?.reportAccessSecureLink || !latest.reportGeneratedTime) {
    throw new Error(
      `完了した実行がありません（reportId=${deps.reportId}）。実行の状態は、Store Insights の mode=usage-status で確かめられます`,
    );
  }

  const csv = await deps.client.downloadText(latest.reportAccessSecureLink);
  const info = inspectUsageCsv(csv);
  const saved = await deps.dropbox.upload(
    `${SNAPSHOT_DIR}/${snapshotName(latest.reportGeneratedTime)}`,
    csv,
  );
  const result: UsageArchiveResult = {
    ...info,
    reportId: deps.reportId,
    executionId: latest.executionId,
    reportGeneratedTime: latest.reportGeneratedTime,
    dropboxPath: saved.path,
    bytes: saved.size,
  };
  deps.evidence?.json("archive", result);
  deps.log(
    `Dropbox へ保存しました（${result.dropboxPath}、${result.bytes} バイト、${info.rows} 行、${info.firstDate ?? "-"} 〜 ${info.lastDate ?? "-"}）`,
  );
  return result;
}

export function usageArchiveMarkdown(result: UsageArchiveResult): string {
  return [
    "## Insights API: 日別の利用統計を Dropbox へ保存した",
    "",
    "| 項目 | 値 |",
    "| --- | --- |",
    `| 実行の生成時刻 | ${result.reportGeneratedTime} |`,
    `| 保存先（アプリのフォルダー内） | ${result.dropboxPath} |`,
    `| サイズ | ${result.bytes} バイト |`,
    `| 行数 | ${result.rows} |`,
    `| 日付の範囲 | ${result.firstDate ?? "-"} 〜 ${result.lastDate ?? "-"} |`,
    "",
    "日別の値は、公開の記録に出さない（Dropbox にだけある）。",
    "",
  ].join("\n");
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
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const secrets = [
    process.env.AZURE_AD_APPLICATION_SECRET,
    process.env.AZURE_AD_TENANT_ID,
    process.env.AZURE_AD_APPLICATION_CLIENT_ID,
    process.env.DROPBOX_APP_KEY,
    process.env.DROPBOX_APP_SECRET,
    process.env.DROPBOX_REFRESH_TOKEN,
  ];

  try {
    const { values } = parseArgs({
      options: {
        "evidence-dir": { type: "string" },
        "report-id": { type: "string" },
        "read-only": { type: "boolean", default: false },
      },
    });
    if (!values["read-only"]) {
      throw new Error(
        "usage-archive は、承認のない読み取り専用のジョブ（--read-only）でだけ動かします",
      );
    }
    const reportId = values["report-id"];
    if (!reportId) throw new Error("--report-id が必要です");
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

    const [
      appId,
      tenantId,
      clientId,
      clientSecret,
      appKey,
      appSecret,
      refreshToken,
    ] = requiredEnv(process.env, [
      "STORE_PRODUCT_ID",
      "AZURE_AD_TENANT_ID",
      "AZURE_AD_APPLICATION_CLIENT_ID",
      "AZURE_AD_APPLICATION_SECRET",
      "DROPBOX_APP_KEY",
      "DROPBOX_APP_SECRET",
      "DROPBOX_REFRESH_TOKEN",
    ]) as [string, string, string, string, string, string, string];

    const client = new StoreClient({
      fetch: (input, init) => fetch(input, init),
      appId,
      tenantId,
      clientId,
      clientSecret,
      baseUrl: INSIGHTS_BASE_URL,
      trace: (line) => log(`[trace] ${line}`),
      readOnly: true,
    });
    const dropbox = new DropboxClient({
      fetch: (input, init) => fetch(input, init),
      appKey,
      appSecret,
      refreshToken,
      trace: (line) => log(`[trace] ${line}`),
    });

    const result = await runUsageArchive({
      client,
      dropbox,
      reportId,
      evidence,
      log,
    });
    if (summary) appendFileSync(summary, usageArchiveMarkdown(result));
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
        mode: "usage-archive",
        runId: process.env.GITHUB_RUN_ID,
        evidenceDir,
        secrets,
      },
    );
    process.exit(1);
  }
}
