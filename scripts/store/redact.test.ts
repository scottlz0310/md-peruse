import { describe, expect, test } from "bun:test";
import { REDACTED, redact, redactText } from "./redact";

describe("redactText", () => {
  test("既知の秘密値は、何回出ても取り除く", () => {
    expect(
      redactText("値 abc123XYZ と abc123XYZ と abc123XYZ", ["abc123XYZ"]),
    ).toBe(`値 ${REDACTED} と ${REDACTED} と ${REDACTED}`);
  });

  test("未定義の値と、短い値（4 文字未満）は、無関係な文字列を巻き込まないよう無視する", () => {
    expect(redactText("ab cd abc", [undefined, "ab", ""])).toBe("ab cd abc");
  });

  test("長い値を先に取り除く（短い値が、長い値の一部を残さない）", () => {
    expect(
      redactText("x secret-long-value y", ["secret", "secret-long-value"]),
    ).toBe(`x ${REDACTED} y`);
  });

  test.each([
    [
      "署名つき URL の署名（以降のパラメーターは残す）",
      "https://blob.example/c/f?sv=1&sig=AbC%2Fdef%3D&se=2",
      `https://blob.example/c/f?sv=1&sig=${REDACTED}&se=2`,
    ],
    [
      "Bearer トークン",
      "Authorization: Bearer abc.def-ghi_jkl~mno+pqr/stu=",
      `Authorization: Bearer ${REDACTED}`,
    ],
    [
      "JWT",
      "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def done",
      `token ${REDACTED} done`,
    ],
    [
      "client_secret のパラメーター",
      "grant_type=client_credentials&client_secret=XYZ123&resource=r",
      `grant_type=client_credentials&client_secret=${REDACTED}&resource=r`,
    ],
    [
      "XML のエラーの中の署名",
      "<Error><Message>sig=SECRETSIG failed</Message></Error>",
      `<Error><Message>sig=${REDACTED} failed</Message></Error>`,
    ],
  ])("形で分かる秘密（既知の値が無くても）: %s", (_name, input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  test("秘密を含まない文字列は、変えない", () => {
    const text =
      '{"code":"InvalidParameterValue","target":"allowTargetFutureDeviceFamilies"}';
    expect(redactText(text, ["unrelated-secret"])).toBe(text);
  });
});

describe("redact", () => {
  test.each([
    ["数値", 1, 1],
    ["真偽値", true, true],
    ["null", null, null],
    ["秘密のない文字列", "https://example/x", "https://example/x"],
  ])("%s はそのまま", (_name, input, expected) => {
    expect(redact(input)).toEqual(expected);
  });

  test("キー名が資格情報を示す値と、fileUploadUrl を、値ごと取り除く（大文字小文字を問わない）", () => {
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

  test("文字列の値の中に埋まった秘密値（応答の本文など）も、取り除く", () => {
    const body = JSON.stringify({
      message: "denied for tenant tenant-1234 with secret s3cr3t-value",
      detail: "https://blob/x?sv=1&sig=SIGVALUE",
    });
    const result = JSON.stringify(
      redact({ responseBody: body }, ["s3cr3t-value", "tenant-1234"]),
    );
    expect(result).not.toContain("s3cr3t-value");
    expect(result).not.toContain("tenant-1234");
    expect(result).not.toContain("SIGVALUE");
    expect(result).toContain("denied for tenant");
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
      `https://b/x?sig=${REDACTED}`,
    );
    expect(result.listings["en-us"].images[0]?.name).toBe("a");
    expect(original).toEqual(copy);
  });
});
