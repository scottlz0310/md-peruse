import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { StoreApiError } from "./client";
import {
  createEvidence,
  describeFailure,
  type EvidenceFs,
  failureSummary,
  reportFailure,
} from "./evidence";
import { REDACTED } from "./redact";

function memory() {
  const dirs: string[] = [];
  const files = new Map<string, string>();
  const fs: EvidenceFs = {
    mkdir: (dir) => dirs.push(dir),
    write: (path, text) => files.set(path, text),
    append: (path, text) => files.set(path, (files.get(path) ?? "") + text),
  };
  return { dirs, files, fs };
}
const now = () => new Date("2026-10-04T01:02:03.000Z");

/** 実行時の秘密値に見立てた、探しやすい値。出力のどこにも現れてはならない。 */
const SECRET = "CANARY-client-secret-8f3a";
const TENANT = "CANARY-tenant-1d9c";
const SIG = "CANARYSIG7e41";
const SECRETS = [SECRET, TENANT];

describe("createEvidence", () => {
  test("フォルダーを作り、JSON を整形して保存する（資格情報は取り除く）", () => {
    const { dirs, files, fs } = memory();
    const evidence = createEvidence({ dir: "out", fs, now });
    evidence.json("04-created", { id: "1", fileUploadUrl: "https://b?sig=S" });

    expect(dirs).toEqual(["out"]);
    const text = files.get(join("out", "04-created.json")) ?? "";
    expect(text).toBe(
      `${JSON.stringify({ id: "1", fileUploadUrl: REDACTED }, null, 2)}\n`,
    );
    expect(text).not.toContain("sig=");
  });

  test("run.log に、時刻つきで 1 行ずつ追記する", () => {
    const { files, fs } = memory();
    const evidence = createEvidence({ dir: "out", fs, now });
    evidence.line("一行目");
    evidence.line("二行目");
    expect(files.get(join("out", "run.log"))).toBe(
      "2026-10-04T01:02:03.000Z 一行目\n2026-10-04T01:02:03.000Z 二行目\n",
    );
  });

  test("run.log と JSON の文字列から、実行時の秘密値を取り除く", () => {
    const { files, fs } = memory();
    const evidence = createEvidence({ dir: "out", fs, now, secrets: SECRETS });
    evidence.line(`拒否された: secret=${SECRET} tenant=${TENANT}`);
    evidence.json("x", { body: `tenant ${TENANT} sig=${SIG}` });
    const all = [...files.values()].join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(TENANT);
    expect(all).not.toContain(SIG);
    expect(all).toContain("拒否された");
  });
});

describe("describeFailure", () => {
  test("StoreApiError は、状態コード、相関 ID、応答の本文を持つ", () => {
    const error = new StoreApiError("拒否された", 400, {
      correlation: "MS-CV=cv-1",
      responseBody: '{"code":"X"}',
    });
    expect(describeFailure(error)).toEqual({
      name: "StoreApiError",
      message: "拒否された",
      httpStatus: 400,
      correlation: "MS-CV=cv-1",
      responseBody: '{"code":"X"}',
    });
  });

  test("相関 ID が空なら、持たない", () => {
    const error = new StoreApiError("x", 500, { correlation: "" });
    expect(describeFailure(error).correlation).toBeUndefined();
  });

  test.each([
    [
      "Error",
      new Error("通常のエラー"),
      { name: "Error", message: "通常のエラー" },
    ],
    ["文字列", "文字列の例外", { name: "Error", message: "文字列の例外" }],
  ])("%s", (_name, error, expected) => {
    expect(describeFailure(error)).toEqual(expected);
  });

  test("メッセージと応答の本文に埋まった秘密値を取り除く", () => {
    const error = new StoreApiError(
      `Store API のエラー: PUT x（HTTP 400）denied ${SECRET} sig=${SIG}`,
      400,
      { responseBody: `tenant ${TENANT} sig=${SIG}`, correlation: "MS-CV=c" },
    );
    const report = describeFailure(error, SECRETS);
    const text = JSON.stringify(report);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(TENANT);
    expect(text).not.toContain(SIG);
    expect(report.httpStatus).toBe(400);
    expect(report.correlation).toBe("MS-CV=c");
  });
});

describe("failureSummary", () => {
  test("エラー、状態コード、相関 ID、証跡の場所を書く", () => {
    const text = failureSummary(
      {
        name: "StoreApiError",
        message: "PUT が拒否された",
        httpStatus: 400,
        correlation: "MS-CV=cv-1",
      },
      { mode: "draft-only", runId: "123", evidenceDir: "/tmp/e" },
    );
    expect(text).toContain("## Store 提出（失敗: draft-only）");
    expect(text).toContain("エラー: PUT が拒否された");
    expect(text).toContain("HTTP の状態コード: 400");
    expect(text).toContain("`MS-CV=cv-1`");
    expect(text).toContain("store-evidence-*");
    expect(text).toContain("実行 ID: 123");
  });

  test("証跡のフォルダーが無ければ、証跡の行を出さない", () => {
    const text = failureSummary(
      { name: "Error", message: "x" },
      { mode: "dry-run" },
    );
    expect(text).not.toContain("証跡");
    expect(text).not.toContain("相関 ID");
  });
});

describe("reportFailure（全ての出口に、秘密値を出さない）", () => {
  function setup() {
    const { files, fs } = memory();
    const stderr: string[] = [];
    const summary: string[] = [];
    const evidence = createEvidence({ dir: "out", fs, now, secrets: SECRETS });
    return { files, stderr, summary, evidence };
  }

  test("応答の本文に秘密値が含まれる失敗でも、標準エラー、run.log、error.json、Step Summary のどこにも出ない", () => {
    const { files, stderr, summary, evidence } = setup();
    const body = `{"message":"bad ${SECRET} for tenant ${TENANT}","url":"https://blob/x?sv=1&sig=${SIG}"}`;
    const error = new StoreApiError(
      `Store API のエラー: PUT applications/X/submissions/1（HTTP 401、MS-CV=cv-1）${body}`,
      401,
      { correlation: "MS-CV=cv-1", responseBody: body },
    );

    reportFailure(
      error,
      {
        stderr: (text) => stderr.push(text),
        appendSummary: (text) => summary.push(text),
        evidence,
      },
      { mode: "draft-only", runId: "7", evidenceDir: "out", secrets: SECRETS },
    );

    const outputs = {
      stderr: stderr.join("\n"),
      summary: summary.join("\n"),
      files: [...files.values()].join("\n"),
    };
    for (const [place, text] of Object.entries(outputs)) {
      expect(text, `${place} に秘密値が出ている`).not.toContain(SECRET);
      expect(text, `${place} に秘密値が出ている`).not.toContain(TENANT);
      expect(text, `${place} に署名が出ている`).not.toContain(SIG);
    }
    // 調査に必要な情報は残る。
    expect(outputs.stderr).toContain("HTTP 401");
    expect(outputs.summary).toContain("MS-CV=cv-1");
    expect(files.has(join("out", "error.json"))).toBe(true);
    expect(files.get(join("out", "run.log"))).toContain("失敗: ");
  });

  test("証跡も Step Summary も無くても、標準エラーに出す（秘密値は取り除く）", () => {
    const stderr: string[] = [];
    const report = reportFailure(
      new Error(`x ${SECRET}`),
      { stderr: (text) => stderr.push(text) },
      { mode: "dry-run", secrets: SECRETS },
    );
    expect(stderr).toEqual([`x ${REDACTED}`]);
    expect(report.message).toBe(`x ${REDACTED}`);
  });
});
