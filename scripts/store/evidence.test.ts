import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { StoreApiError } from "./client";
import {
  createEvidence,
  describeFailure,
  type EvidenceFs,
  failureSummary,
  REDACTED,
  redact,
} from "./evidence";

describe("redact", () => {
  test.each([
    [
      "署名つき URL の文字列",
      "https://blob/x?sv=1&sig=ABC",
      `${REDACTED}（署名つき URL）`,
    ],
    ["署名のない文字列", "https://example/x", "https://example/x"],
    ["数値、真偽値、null はそのまま", 1, 1],
  ])("%s", (_name, input, expected) => {
    expect(redact(input)).toEqual(expected);
  });

  test("キー名が資格情報を示す値と、fileUploadUrl を取り除く（大文字小文字を問わない）", () => {
    expect(
      redact({
        id: "1",
        fileUploadUrl: "https://blob/x?sig=S",
        access_token: "t",
        Client_Secret: "s",
        Authorization: "Bearer x",
        password: "p",
        title: "md-peruse",
      }),
    ).toEqual({
      id: "1",
      fileUploadUrl: REDACTED,
      access_token: REDACTED,
      Client_Secret: REDACTED,
      Authorization: REDACTED,
      password: REDACTED,
      title: "md-peruse",
    });
  });

  test("入れ子の配列とオブジェクトの中も取り除き、元の値は変えない", () => {
    const original = {
      listings: {
        "en-us": { images: [{ url: "https://b/x?sig=S", name: "a" }] },
      },
    };
    const copy = structuredClone(original);
    const result = redact(original) as typeof original;
    expect(result.listings["en-us"].images[0]?.url).toBe(
      `${REDACTED}（署名つき URL）`,
    );
    expect(result.listings["en-us"].images[0]?.name).toBe("a");
    expect(original).toEqual(copy);
  });
});

describe("createEvidence", () => {
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
