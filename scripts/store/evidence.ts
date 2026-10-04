// 実走の証跡（記録）を残す。
//
// Store の API は、実走でしか分からない拒否が多い。実走のたびに、見えない部分を推測して直す往復に
// ならないよう、呼び出しの記録（トレース）と、申請の JSON（公開済み、作成した申請、PUT の本文と応答）を、
// 失敗しても残す。保存先のフォルダーは `--evidence-dir` で渡し、ワークフローが artifact にする。
//
// 資格情報（トークン、シークレット）と、署名つき URL（SAS）は、記録に含めない（`redact`）。

import { join } from "node:path";
import { StoreApiError } from "./client";

export const REDACTED = "<記録しない>";

/** 値に含めてはならないキー。申請の JSON には、通常は無い（防御のため）。 */
const SECRET_KEY = /token|secret|authorization|password|fileUploadUrl/i;
/** 署名つきの URL（SAS）。 */
const SIGNED_URL = /[?&]sig=/i;

/** 資格情報と署名つき URL を取り除いた、JSON の複製を返す。 */
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return SIGNED_URL.test(value) ? `${REDACTED}（署名つき URL）` : value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEY.test(key) ? REDACTED : redact(entry),
      ]),
    );
  }
  return value;
}

export interface EvidenceFs {
  mkdir: (dir: string) => void;
  write: (path: string, text: string) => void;
  append: (path: string, text: string) => void;
}

export interface Evidence {
  /** `<name>.json` として、整形した JSON を保存する（`redact` を通す）。 */
  json: (name: string, data: unknown) => void;
  /** `run.log` に、時刻つきで 1 行を追記する。 */
  line: (message: string) => void;
}

export function createEvidence(options: {
  dir: string;
  fs: EvidenceFs;
  now: () => Date;
}): Evidence {
  const { dir, fs, now } = options;
  fs.mkdir(dir);
  return {
    json: (name, data) =>
      fs.write(
        join(dir, `${name}.json`),
        `${JSON.stringify(redact(data), null, 2)}\n`,
      ),
    line: (message) =>
      fs.append(join(dir, "run.log"), `${now().toISOString()} ${message}\n`),
  };
}

export interface FailureReport {
  name: string;
  message: string;
  httpStatus?: number;
  correlation?: string;
  responseBody?: string;
}

/** 例外から、証跡と要約に残す内容を取り出す。 */
export function describeFailure(error: unknown): FailureReport {
  if (error instanceof StoreApiError) {
    return {
      name: error.name,
      message: error.message,
      httpStatus: error.httpStatus,
      correlation: error.correlation || undefined,
      responseBody: error.responseBody,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

/** 失敗したときの、GitHub の Step Summary（Markdown）。 */
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
