import { describe, expect, test } from "bun:test";
import {
  FIND_EXCLUDED_SELECTORS,
  type FindDirection,
  findMatchOffsets,
  foldForFind,
  MAX_FIND_MATCHES,
  stepMatchIndex,
} from "./find";

describe("foldForFind", () => {
  const cases: ReadonlyArray<{
    name: string;
    input: string;
    expected: string;
  }> = [
    {
      name: "ASCIIの大文字を小文字へ畳む",
      input: "Target",
      expected: "target",
    },
    { name: "小文字はそのまま", input: "target", expected: "target" },
    {
      name: "全角英字は全角のまま畳む",
      input: "Ａ",
      expected: "ａ",
    },
    { name: "日本語はそのまま", input: "検索対象", expected: "検索対象" },
    {
      name: "半角カナの濁点は合成しない",
      input: "ｶﾞ",
      expected: "ｶﾞ",
    },
    {
      name: "小文字化でコードユニットが伸びる文字は元のまま残す",
      input: "İ",
      expected: "İ",
    },
    {
      name: "大文字シャープSは長さが変わらないので畳む",
      input: "ẞ",
      expected: "ß",
    },
  ];

  for (const { name, input, expected } of cases) {
    test(name, () => {
      expect(foldForFind(input)).toBe(expected);
    });
  }

  test("畳んでもコードユニット数が変わらない", () => {
    // Rangeのオフセットはコードユニットで数えるため、長さが変わると一致位置をDOMへ戻せない。
    const samples = [
      "İ",
      "ß",
      "ẞ",
      "Σ",
      "ς",
      "Ａ",
      "ｶﾞ",
      "𝐀",
      "AİB",
      "検索Target",
    ];
    for (const sample of samples) {
      expect(foldForFind(sample).length).toBe(sample.length);
    }
  });

  test("全角と半角は一致しない", () => {
    // 互換正規化を行わないため、表記の違いは別の文字列として扱う（design-decisions.md 8.6）。
    expect(foldForFind("Ａ")).not.toBe(foldForFind("A"));
    expect(foldForFind("ｶﾞ")).not.toBe(foldForFind("ガ"));
  });

  test("語末シグマは大文字シグマと一致しない", () => {
    // 長さを保つことを優先した結果として残る非対称（design-decisions.md 8.6）。
    expect(foldForFind("Σ")).not.toBe(foldForFind("ς"));
  });
});

describe("findMatchOffsets", () => {
  const cases: ReadonlyArray<{
    name: string;
    haystack: string;
    needle: string;
    expected: readonly number[];
  }> = [
    {
      name: "大文字小文字を区別せずに一致する",
      haystack: "Target and target",
      needle: "TARGET",
      expected: [0, 11],
    },
    {
      name: "重なる一致は数えない",
      haystack: "aaaa",
      needle: "aa",
      expected: [0, 2],
    },
    {
      name: "日本語の連続する一致を数える",
      haystack: "検索対象と検索対象",
      needle: "検索対象",
      expected: [0, 5],
    },
    {
      name: "一致しないときは空",
      haystack: "検索対象",
      needle: "存在しない",
      expected: [],
    },
    {
      name: "空の検索語は何も返さない",
      haystack: "検索対象",
      needle: "",
      expected: [],
    },
    {
      name: "コードユニットが伸びる文字を含んでも位置がずれない",
      haystack: "İstanbul と istanbul",
      needle: "stanbul",
      expected: [1, 12],
    },
  ];

  for (const { name, haystack, needle, expected } of cases) {
    test(name, () => {
      expect(findMatchOffsets(haystack, needle)).toEqual([...expected]);
    });
  }

  test("上限で打ち切る", () => {
    const haystack = "a".repeat(MAX_FIND_MATCHES + 100);
    expect(findMatchOffsets(haystack, "a")).toHaveLength(MAX_FIND_MATCHES);
  });

  test("返した位置が元の文字列の一致位置を指す", () => {
    const haystack = "İstanbul と istanbul";
    for (const offset of findMatchOffsets(haystack, "STANBUL")) {
      expect(foldForFind(haystack.slice(offset, offset + 7))).toBe("stanbul");
    }
  });
});

describe("stepMatchIndex", () => {
  const cases: ReadonlyArray<{
    name: string;
    matchCount: number;
    current: number;
    direction: FindDirection;
    expected: number;
  }> = [
    {
      name: "次へ進む",
      matchCount: 3,
      current: 0,
      direction: "next",
      expected: 1,
    },
    {
      name: "末尾から次へ進むと先頭へ折り返す",
      matchCount: 3,
      current: 2,
      direction: "next",
      expected: 0,
    },
    {
      name: "前へ戻る",
      matchCount: 3,
      current: 2,
      direction: "previous",
      expected: 1,
    },
    {
      name: "先頭から前へ戻ると末尾へ折り返す",
      matchCount: 3,
      current: 0,
      direction: "previous",
      expected: 2,
    },
    {
      name: "未選択から次へ進むと先頭を選ぶ",
      matchCount: 3,
      current: -1,
      direction: "next",
      expected: 0,
    },
    {
      name: "未選択から前へ戻ると末尾を選ぶ",
      matchCount: 3,
      current: -1,
      direction: "previous",
      expected: 2,
    },
    {
      name: "一致がなければ未選択のまま",
      matchCount: 0,
      current: -1,
      direction: "next",
      expected: -1,
    },
  ];

  for (const { name, matchCount, current, direction, expected } of cases) {
    test(name, () => {
      expect(stepMatchIndex(matchCount, current, direction)).toBe(expected);
    });
  }
});

describe("FIND_EXCLUDED_SELECTORS", () => {
  test("KaTeXの出力とSVGを除外する", () => {
    // KaTeXはMathMLのテキストとannotation要素のLaTeXを二重に持ち、Mermaidの図はSVGとして
    // 出力される（design-decisions.md 8.6）。
    expect([...FIND_EXCLUDED_SELECTORS]).toEqual([".katex", "svg"]);
  });
});
