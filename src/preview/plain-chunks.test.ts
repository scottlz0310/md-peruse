import { describe, expect, test } from "bun:test";
import {
  CLUSTER_SEARCH_CHARS,
  PLAIN_CHUNK_CHARS,
  splitPlainText,
} from "./plain-chunks";

/** 対になっていないサロゲートを含むか。 */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** 1つの文字列の長さの上限（書記素の境界を探す範囲と、サロゲートペアの1つを含む）。 */
const maxChunkLength = (chunkChars: number) =>
  2 * chunkChars + CLUSTER_SEARCH_CHARS + 1;

/** 本文の書記素の境界（各書記素の開始位置と、末尾）。 */
function graphemeBoundaries(text: string): Set<number> {
  const boundaries = new Set<number>([text.length]);
  for (const { index } of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(text)) {
    boundaries.add(index);
  }
  return boundaries;
}

/** 分けた文字列の切れ目が、すべて書記素の境界か。 */
function splitsOnlyAtGraphemeBoundaries(
  text: string,
  chunks: string[],
): boolean {
  const boundaries = graphemeBoundaries(text);
  let position = 0;
  for (const chunk of chunks) {
    position += chunk.length;
    if (!boundaries.has(position)) return false;
  }
  return true;
}

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
    ["ゼロ幅接合子は、直前の文字につなぐ", "aaa‍b‍cc", 2, ["aaa‍", "b‍cc"]],
    [
      "肌色の修飾子の直前では切らない",
      "aaa\u{1F44D}\u{1F3FD}bb",
      2,
      ["aaa\u{1F44D}\u{1F3FD}", "bb"],
    ],
    [
      "国旗の2文字の間では切らない",
      "aaa\u{1F1EF}\u{1F1F5}bb",
      2,
      ["aaa\u{1F1EF}\u{1F1F5}", "bb"],
    ],
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

  // 途中で切ると、表示や読み上げが変わる文字の並び。
  const sequences: [string, string][] = [
    ["肌色の修飾子", "\u{1F44D}\u{1F3FD}"],
    ["国旗", "\u{1F1EF}\u{1F1F5}"],
    ["続く2つの国旗", "\u{1F1EF}\u{1F1F5}\u{1F1FA}\u{1F1F8}"],
    [
      "タグ文字の国旗（イングランド）",
      "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}",
    ],
    ["囲み数字", "1️⃣"],
    ["ゼロ幅接合子でつながる絵文字", "\u{1F468}‍\u{1F469}‍\u{1F467}"],
    ["結合文字", "é̂"],
    ["ハングルの字母の並び", "각"],
    ["デーヴァナーガリーの合字", "क्ष"],
  ];

  test.each(sequences)(
    "%s を、長さ1〜8でも途中で切らない",
    (_name, sequence) => {
      for (let chunkChars = 1; chunkChars <= 8; chunkChars++) {
        for (let padding = 0; padding <= 3; padding++) {
          const text = `${"a".repeat(padding)}${sequence}b${sequence}cc`;
          const chunks = splitPlainText(text, chunkChars);
          expect(chunks.join("")).toBe(text);
          expect(splitsOnlyAtGraphemeBoundaries(text, chunks)).toBe(true);
        }
      }
    },
  );

  test("つなぎ合わせると元の本文になり、切れ目は書記素の境界で、対にならないサロゲートを含まない", () => {
    const alphabet = [
      "a",
      "b",
      " ",
      "\n",
      "あ",
      "\u{1F600}",
      "é",
      "‍",
      "️",
      "\u{1F44D}\u{1F3FD}",
      "\u{1F1EF}\u{1F1F5}",
    ];
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
      expect(splitsOnlyAtGraphemeBoundaries(text, chunks)).toBe(true);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.length).toBeLessThanOrEqual(maxChunkLength(chunkChars));
        expect(LONE_SURROGATE.test(chunk)).toBe(false);
      }
    }
  });

  test("最後の文字列を除き、長さは chunkChars 以上で、その2倍以内である", () => {
    const text = "あいうえお かきくけこ\n".repeat(500);
    const chunkChars = 100;
    const chunks = splitPlainText(text, chunkChars);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.length).toBeGreaterThanOrEqual(chunkChars);
      expect(chunk.length).toBeLessThanOrEqual(chunkChars * 2);
    }
  });

  // 判定の範囲の先頭が、文字の途中だと、`Intl.Segmenter` は偽の境界を返す（レビュー指摘）。
  // 既定の上限（10,000文字目）が、長い文字（結合文字が40個続く、ZWJでつながる絵文字。国旗の並び）の
  // 途中に当たる位置を、前置の文字数を変えて試す。
  test.each([
    [
      "結合文字が続くZWJの絵文字",
      9_956,
      9_987,
      (padding: number) => `${"a".repeat(padding)}👩${"́".repeat(40)}‍👩x`,
    ],
    [
      "続く国旗",
      9_950,
      9_999,
      (padding: number) => `${"a".repeat(padding)}${"🇯🇵".repeat(20)}x`,
    ],
  ] as [string, number, number, (padding: number) => string][])(
    "%s の途中に上限が当たっても、切れ目は書記素の境界である",
    (_name, from, to, make) => {
      for (let padding = from; padding <= to; padding++) {
        const text = make(padding);
        const chunks = splitPlainText(text);
        expect(chunks.join("")).toBe(text);
        expect(splitsOnlyAtGraphemeBoundaries(text, chunks)).toBe(true);
      }
    },
  );

  // 文字の境界を探し続けると、1つの文字列が上限を超えて長くなる入力（レビュー指摘）。
  test.each([
    ["結合文字", "́"],
    ["ゼロ幅接合子", "‍"],
    ["異体字セレクタ", "️"],
    ["ゼロ幅接合子でつながる絵文字", "\u{1F468}‍"],
    ["タグ文字", "\u{E0067}"],
  ])("%s だけが連なる本文でも、1つの文字列は上限を超えない", (_name, unit) => {
    const text = `a${unit.repeat(Math.ceil(5_000_000 / unit.length))}`;
    const started = performance.now();
    const chunks = splitPlainText(text);
    const elapsed = performance.now() - started;

    expect(chunks.join("")).toBe(text);
    expect(
      Math.max(...chunks.map((chunk) => chunk.length)),
    ).toBeLessThanOrEqual(maxChunkLength(PLAIN_CHUNK_CHARS));
    expect(chunks.length).toBeGreaterThan(
      text.length / maxChunkLength(PLAIN_CHUNK_CHARS) - 1,
    );
    expect(elapsed).toBeLessThan(1_000);
  });

  test("境界が見つからず、上限で切るときも、サロゲートペアの途中では切らない", () => {
    // 異体字セレクタ（U+E0100〜）は、2つの単位でできた結合文字である。
    const selector = "󠄀";
    for (let padding = 0; padding <= 40; padding++) {
      for (const chunkChars of [1, 2, 3, 5, 8, 20]) {
        const text = `${"a".repeat(padding)}${selector.repeat(60)}b`;
        const chunks = splitPlainText(text, chunkChars);
        expect(chunks.join("")).toBe(text);
        for (const chunk of chunks) {
          expect(LONE_SURROGATE.test(chunk)).toBe(false);
          expect(chunk.length).toBeLessThanOrEqual(maxChunkLength(chunkChars));
        }
      }
    }
  });

  test.each([
    ["空白のない1行", () => "a".repeat(5_000_000)],
    ["空白のない1行（日本語）", () => "あ".repeat(3_000_000)],
    ["改行だけの本文", () => "\n".repeat(5_000_000)],
  ])("%s は、本文の長さに比例する時間で分けられる", (_name, make) => {
    const text = make();
    const started = performance.now();
    const chunks = splitPlainText(text);
    const elapsed = performance.now() - started;
    expect(chunks.join("")).toBe(text);
    expect(elapsed).toBeLessThan(1_000);
  });
});
