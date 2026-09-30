import { describe, expect, test } from "bun:test";
import { PLAIN_CHUNK_CHARS, splitPlainText } from "./plain-chunks";

/** 対になっていないサロゲートを含むか。 */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("splitPlainText", () => {
  test.each([
    ["空の本文は空の配列", "", 5, []],
    ["短い本文は1つ", "abc", 5, ["abc"]],
    ["ちょうどの長さは1つ", "abcde", 5, ["abcde"]],
    [
      "改行の直後で切る",
      "abcdefghi\n".repeat(4),
      25,
      ["abcdefghi\n".repeat(3), "abcdefghi\n"],
    ],
    [
      "窓の中に改行と空白があれば、改行を選ぶ",
      "aaaaa bbb\nzzzzzz",
      5,
      ["aaaaa bbb\n", "zzzzzz"],
    ],
    [
      "改行がなければ、空白の直後で切る",
      "aaaaaaaa bbbbbbbb",
      5,
      ["aaaaaaaa ", "bbbbbbbb"],
    ],
    [
      "空白もなければ、窓の上限で切る",
      "a".repeat(25),
      5,
      ["a".repeat(10), "a".repeat(10), "a".repeat(5)],
    ],
    [
      "サロゲートペアの途中では切らない",
      "aaa\u{1F600}bb",
      2,
      ["aaa\u{1F600}", "bb"],
    ],
    ["結合文字の直前では切らない", "aaaébb", 2, ["aaaé", "bb"]],
    ["ゼロ幅接合子の前後では切らない", "aaa‍b‍cc", 2, ["aaa‍b‍c", "c"]],
  ] as [string, string, number, string[]][])(
    "%s",
    (_name, text, chunkChars, expected) => {
      expect(splitPlainText(text, chunkChars)).toEqual(expected);
    },
  );

  test("既定の長さは PLAIN_CHUNK_CHARS である", () => {
    const text = "a".repeat(PLAIN_CHUNK_CHARS * 2 + 1);
    expect(splitPlainText(text).map((chunk) => chunk.length)).toEqual([
      PLAIN_CHUNK_CHARS * 2,
      1,
    ]);
  });

  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
    "ゼロ幅接合子でつながる絵文字の並びを、長さ %i でも途中で切らない",
    (chunkChars) => {
      const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
      const text = `aaaa${family}b${family}cc`;
      const chunks = splitPlainText(text, chunkChars);
      expect(chunks.join("")).toBe(text);
      expect(
        chunks.filter((chunk) => chunk.includes(family)).length,
      ).toBeGreaterThan(0);
      for (const chunk of chunks) {
        // 並びの一部だけを含む文字列は無い
        const parts = chunk.split(family).join("");
        expect(parts).not.toContain("‍");
      }
    },
  );

  test("つなぎ合わせると元の本文になり、どの文字列も対にならないサロゲートを含まない", () => {
    const alphabet = ["a", "b", " ", "\n", "あ", "\u{1F600}", "é", "‍", "️"];
    let seed = 20260930;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 2 ** 32;
      return seed / 2 ** 32;
    };
    for (let round = 0; round < 300; round++) {
      let text = "";
      const length = Math.floor(random() * 200);
      for (let index = 0; index < length; index++) {
        text += alphabet[Math.floor(random() * alphabet.length)];
      }
      const chunkChars = 1 + Math.floor(random() * 12);
      const chunks = splitPlainText(text, chunkChars);
      expect(chunks.join("")).toBe(text);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(LONE_SURROGATE.test(chunk)).toBe(false);
      }
    }
  });

  test("最後の文字列を除き、長さは chunkChars 以上で、結合の余地を除いて2倍以内である", () => {
    const text = "あいうえお かきくけこ\n".repeat(500);
    const chunkChars = 100;
    const chunks = splitPlainText(text, chunkChars);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBeGreaterThanOrEqual(chunkChars);
      expect(chunk.length).toBeLessThanOrEqual(chunkChars * 2);
    }
  });

  test.each([
    ["空白のない1行", () => "a".repeat(5_000_000)],
    ["空白のない1行（日本語）", () => "あ".repeat(3_000_000)],
    ["改行だけの本文", () => "\n".repeat(5_000_000)],
    ["結合文字が連なる本文", () => `a${"́".repeat(1_000_000)}`],
  ])("%s は、本文の長さに比例する時間で分けられる", (_name, make) => {
    const text = make();
    const started = performance.now();
    const chunks = splitPlainText(text);
    const elapsed = performance.now() - started;
    expect(chunks.join("")).toBe(text);
    expect(elapsed).toBeLessThan(1_000);
  });
});
