// 実走の証跡（記録）を残す。
//
// Store の API は、実走でしか分からない拒否が多い。実走のたびに、見えない部分を推測して直す往復に
// ならないよう、呼び出しの記録（トレース）と、申請の JSON（公開済み、作成した申請、PUT の本文と応答）を、
// 失敗しても残す。保存先のフォルダーは `--evidence-dir` で渡し、ワークフローが artifact にする。
//
// 資格情報（トークン、シークレット）と、署名つき URL（SAS）は、記録に含めない。書き出す全ての経路
// （`run.log`、JSON、失敗の報告、Step Summary、標準エラー出力）で、`redact.ts` を通す。

import { join } from "node:path";
import { StoreApiError } from "./client";
import { redact, redactText } from "./redact";

export interface EvidenceFs {
  mkdir: (dir: string) => void;
  write: (path: string, text: string) => void;
  append: (path: string, text: string) => void;
}

export interface Evidence {
  /** `<name>.json` として、整形した JSON を保存する（資格情報は取り除く）。 */
  json: (name: string, data: unknown) => void;
  /** `run.log` に、時刻つきで 1 行を追記する（資格情報は取り除く）。 */
  line: (message: string) => void;
}

export function createEvidence(options: {
  dir: string;
  fs: EvidenceFs;
  now: () => Date;
  /** 実行時に分かる秘密値（シークレットなど）。記録から取り除く。 */
  secrets?: ReadonlyArray<string | undefined>;
}): Evidence {
  const { dir, fs, now, secrets = [] } = options;
  fs.mkdir(dir);
  return {
    json: (name, data) =>
      fs.write(
        join(dir, `${name}.json`),
        `${JSON.stringify(redact(data, secrets), null, 2)}\n`,
      ),
    line: (message) =>
      fs.append(
        join(dir, "run.log"),
        `${now().toISOString()} ${redactText(message, secrets)}\n`,
      ),
  };
}

export interface FailureReport {
  name: string;
  message: string;
  httpStatus?: number;
  correlation?: string;
  responseBody?: string;
}

/**
 * 例外から、証跡と要約に残す内容を取り出す。メッセージ、相関 ID、応答の本文は、
 * 資格情報を取り除いた値にする（応答の本文に、秘密値が含まれるかもしれないため）。
 */
export function describeFailure(
  error: unknown,
  secrets: ReadonlyArray<string | undefined> = [],
): FailureReport {
  const safe = (text: string) => redactText(text, secrets);
  if (error instanceof StoreApiError) {
    return {
      name: error.name,
      message: safe(error.message),
      httpStatus: error.httpStatus,
      correlation: error.correlation ? safe(error.correlation) : undefined,
      responseBody:
        error.responseBody === undefined ? undefined : safe(error.responseBody),
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: safe(error.message) };
  }
  return { name: "Error", message: safe(String(error)) };
}

/** 失敗したときの、GitHub の Step Summary（Markdown）。`report` は取り除き済みの値を渡す。 */
export function failureSummary(
  report: FailureReport,
  options: { mode: string; runId?: string; evidenceDir?: string },
): string {
  const lines = [
    `## Store 提出（失敗: ${options.mode}）`,
    "",
    `エラー: ${report.message}`,
    "",
  ];
  if (report.httpStatus !== undefined) {
    lines.push(`- HTTP の状態コード: ${report.httpStatus}`);
  }
  if (report.correlation) {
    lines.push(
      `- 相関 ID: \`${report.correlation}\`（Microsoft への問い合わせに使う）`,
    );
  }
  if (options.evidenceDir) {
    lines.push(
      `- 証跡: この実行の artifact \`store-evidence-*\`（実行 ID: ${options.runId ?? "不明"}）。呼び出しのトレース（\`run.log\`）、申請の JSON、PUT の本文と応答、\`error.json\` を含む`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export interface FailureOutputs {
  /** 標準エラー出力へ書く（コンソール）。 */
  stderr: (text: string) => void;
  /** GitHub の Step Summary へ追記する（無ければ書かない）。 */
  appendSummary?: (text: string) => void;
  evidence?: Evidence;
}

/**
 * 失敗を、全ての出口（標準エラー、`run.log`、`error.json`、Step Summary）へ報告する。
 * どの出口にも、資格情報を取り除いた値だけを渡す。報告した内容（取り除き済み）を返す。
 */
export function reportFailure(
  error: unknown,
  outputs: FailureOutputs,
  context: {
    mode: string;
    runId?: string;
    evidenceDir?: string;
    secrets?: ReadonlyArray<string | undefined>;
  },
): FailureReport {
  const report = describeFailure(error, context.secrets);
  outputs.stderr(report.message);
  outputs.evidence?.line(`失敗: ${report.message}`);
  outputs.evidence?.json("error", report);
  outputs.appendSummary?.(
    failureSummary(report, {
      mode: context.mode,
      runId: context.runId,
      evidenceDir: context.evidenceDir,
    }),
  );
  return report;
}
