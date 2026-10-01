import { describe, expect, test } from "bun:test";
import { isLicenseAccepted, parseAcceptedLicenses } from "./license-policy";

const accepted = ["MIT", "Apache-2.0", "ISC", "BSD-3-Clause", "EPL-2.0"];

describe("parseAcceptedLicenses", () => {
  test("accepted の一覧から識別子を取り出し、コメントを除く", () => {
    const toml = [
      "# 説明",
      "accepted = [",
      '  "MIT",',
      '  "Apache-2.0", # コメント "GPL-3.0" を含む',
      '  "ISC",',
      "]",
      'targets = ["x86_64-pc-windows-msvc"]',
    ].join("\n");
    expect(parseAcceptedLicenses(toml)).toEqual(["MIT", "Apache-2.0", "ISC"]);
  });

  test("一覧が無い、または空なら失敗する", () => {
    expect(() => parseAcceptedLicenses('targets = ["x"]')).toThrow();
    expect(() => parseAcceptedLicenses("accepted = [\n]")).toThrow();
  });

  test("実際の about.toml を読める", async () => {
    const toml = await Bun.file(
      new URL("../src-tauri/about.toml", import.meta.url),
    ).text();
    const identifiers = parseAcceptedLicenses(toml);
    expect(identifiers).toContain("MIT");
    expect(identifiers).toContain("EPL-2.0");
  });
});

describe("isLicenseAccepted", () => {
  test("単一の識別子", () => {
    expect(isLicenseAccepted("MIT", accepted)).toBe(true);
    expect(isLicenseAccepted("GPL-3.0-only", accepted)).toBe(false);
  });

  test("識別子は大文字小文字を区別しない", () => {
    expect(isLicenseAccepted("mit", accepted)).toBe(true);
  });

  test("OR は、どちらか一方が許容されていればよい", () => {
    expect(isLicenseAccepted("MIT OR GPL-3.0-only", accepted)).toBe(true);
    expect(isLicenseAccepted("(GPL-2.0-only OR MIT)", accepted)).toBe(true);
    expect(isLicenseAccepted("GPL-2.0-only OR GPL-3.0-only", accepted)).toBe(
      false,
    );
  });

  test("AND は、両方が許容されていなければならない", () => {
    expect(isLicenseAccepted("MIT AND ISC", accepted)).toBe(true);
    expect(isLicenseAccepted("MIT AND GPL-3.0-only", accepted)).toBe(false);
  });

  test("AND は OR より強く結ぶ", () => {
    // MIT OR (GPL AND ISC) と読むため、MIT だけで満たせる。
    expect(isLicenseAccepted("MIT OR GPL-3.0-only AND ISC", accepted)).toBe(
      true,
    );
    // (GPL AND MIT) OR GPL と読むため、満たせない。
    expect(
      isLicenseAccepted("GPL-3.0-only AND MIT OR GPL-2.0-only", accepted),
    ).toBe(false);
  });

  test("WITH は基底の識別子で判定する", () => {
    expect(isLicenseAccepted("Apache-2.0 WITH LLVM-exception", accepted)).toBe(
      true,
    );
    expect(
      isLicenseAccepted("GPL-3.0-only WITH Classpath-exception-2.0", accepted),
    ).toBe(false);
  });

  test("式として読めないものは許容しない", () => {
    expect(isLicenseAccepted("SEE LICENSE IN LICENSE.txt", accepted)).toBe(
      false,
    );
    expect(isLicenseAccepted("", accepted)).toBe(false);
    expect(isLicenseAccepted("(MIT", accepted)).toBe(false);
    expect(isLicenseAccepted("MIT OR", accepted)).toBe(false);
    expect(isLicenseAccepted("MIT ISC", accepted)).toBe(false);
  });

  test("許容リストが空なら、何も許容しない", () => {
    expect(isLicenseAccepted("MIT", [])).toBe(false);
  });
});
