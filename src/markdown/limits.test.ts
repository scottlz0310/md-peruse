import { describe, expect, test } from "bun:test";
import {
  DOCUMENT_LIMITS,
  HIGHLIGHT_LIMITS,
  highlightCost,
  KATEX_LIMITS,
  mathRenderCost,
  type PlainDocumentReason,
  plainDocumentReason,
  shouldHighlight,
  shouldRenderMath,
} from "./limits";

/** 予算を使い切るまで同じサイズの単位を処理し、通った個数を返す。 */
function countAccepted(
  unitBytes: number,
  cost: (bytes: number) => number,
  accepts: (bytes: number, spent: number) => boolean,
): number {
  let spent = 0;
  let accepted = 0;
  while (accepts(unitBytes, spent)) {
    spent += cost(unitBytes);
    accepted += 1;
  }
  return accepted;
}

describe("mathRenderCost", () => {
  test.each([
    // 説明, 入力サイズ, コスト
    ["最小コストより短い数式", 1, KATEX_LIMITS.minFormulaCostBytes],
    [
      "最小コストちょうど",
      KATEX_LIMITS.minFormulaCostBytes,
      KATEX_LIMITS.minFormulaCostBytes,
    ],
    [
      "最小コストより長い数式",
      KATEX_LIMITS.minFormulaCostBytes + 1,
      KATEX_LIMITS.minFormulaCostBytes + 1,
    ],
  ])("%s", (_name, bytes, expected) => {
    expect(mathRenderCost(bytes)).toBe(expected);
  });
});

describe("shouldRenderMath", () => {
  test.each([
    // 説明, 1数式のサイズ, 消費済みの予算, 描画するか
    ["上限ちょうどの数式", KATEX_LIMITS.perFormulaBytes, 0, true],
    ["上限を1バイト超える数式", KATEX_LIMITS.perFormulaBytes + 1, 0, false],
    [
      "予算が数式1つぶん残っている",
      KATEX_LIMITS.perFormulaBytes,
      KATEX_LIMITS.perDocumentBytes - KATEX_LIMITS.perFormulaBytes,
      true,
    ],
    [
      "予算が1バイト足りない",
      KATEX_LIMITS.perFormulaBytes,
      KATEX_LIMITS.perDocumentBytes - KATEX_LIMITS.perFormulaBytes + 1,
      false,
    ],
    [
      "予算が尽きていれば1バイトの数式も描画しない",
      1,
      KATEX_LIMITS.perDocumentBytes,
      false,
    ],
    [
      "1バイトの数式も最小コストを消費する",
      1,
      KATEX_LIMITS.perDocumentBytes - KATEX_LIMITS.minFormulaCostBytes + 1,
      false,
    ],
    ["通常の数式", 200, 0, true],
  ])("%s", (_name, formulaBytes, spentBudget, expected) => {
    expect(shouldRenderMath(formulaBytes, spentBudget)).toBe(expected);
  });

  test("多数の1バイト数式が個数で頭打ちになる", () => {
    // 本文のバイト数だけで数えると65536個が通り、39万要素・数秒に達する
    // （design-decisions.md 8.5）。最小コストにより2048個で止まる。
    const accepted = countAccepted(1, mathRenderCost, shouldRenderMath);
    expect(accepted).toBe(
      KATEX_LIMITS.perDocumentBytes / KATEX_LIMITS.minFormulaCostBytes,
    );
    expect(accepted).toBeLessThan(KATEX_LIMITS.perDocumentBytes);
  });
});

describe("highlightCost", () => {
  test.each([
    // 説明, 入力サイズ, コスト
    ["最小コストより短いブロック", 1, HIGHLIGHT_LIMITS.minBlockCostBytes],
    [
      "最小コストより長いブロック",
      HIGHLIGHT_LIMITS.minBlockCostBytes + 1,
      HIGHLIGHT_LIMITS.minBlockCostBytes + 1,
    ],
  ])("%s", (_name, bytes, expected) => {
    expect(highlightCost(bytes)).toBe(expected);
  });
});

describe("shouldHighlight", () => {
  test.each([
    // 説明, 1ブロックのサイズ, 消費済みの予算, ハイライトするか
    ["上限ちょうどのブロック", HIGHLIGHT_LIMITS.perBlockBytes, 0, true],
    [
      "上限を1バイト超えるブロック",
      HIGHLIGHT_LIMITS.perBlockBytes + 1,
      0,
      false,
    ],
    [
      "予算がブロック1つぶん残っている",
      HIGHLIGHT_LIMITS.perBlockBytes,
      HIGHLIGHT_LIMITS.perDocumentBytes - HIGHLIGHT_LIMITS.perBlockBytes,
      true,
    ],
    [
      "予算が1バイト足りない",
      HIGHLIGHT_LIMITS.perBlockBytes,
      HIGHLIGHT_LIMITS.perDocumentBytes - HIGHLIGHT_LIMITS.perBlockBytes + 1,
      false,
    ],
    ["通常のブロック", 2_000, 0, true],
  ])("%s", (_name, blockBytes, spentBudget, expected) => {
    expect(shouldHighlight(blockBytes, spentBudget)).toBe(expected);
  });

  test("多数の1バイトブロックが個数で頭打ちになる", () => {
    const accepted = countAccepted(1, highlightCost, shouldHighlight);
    expect(accepted).toBe(
      HIGHLIGHT_LIMITS.perDocumentBytes / HIGHLIGHT_LIMITS.minBlockCostBytes,
    );
  });
});

describe("上限どうしの関係", () => {
  test.each([
    // 説明, 1単位の上限, 文書の上限, 最小コスト
    [
      "数式",
      KATEX_LIMITS.perFormulaBytes,
      KATEX_LIMITS.perDocumentBytes,
      KATEX_LIMITS.minFormulaCostBytes,
    ],
    [
      "コードブロック",
      HIGHLIGHT_LIMITS.perBlockBytes,
      HIGHLIGHT_LIMITS.perDocumentBytes,
      HIGHLIGHT_LIMITS.minBlockCostBytes,
    ],
  ])("%s の上限が矛盾しない", (_name, perUnit, perDocument, minCost) => {
    // 1単位の上限が文書の上限を超えると、単体では上限内の入力が1つも処理できない。
    expect(perUnit).toBeLessThanOrEqual(perDocument);
    // 最小コストが1単位の上限を超えると、すべての入力が同じコストになる。
    expect(minCost).toBeLessThan(perUnit);
  });

  test("数式の上限はコードブロックより厳しい", () => {
    // KaTeXの出力は入力の約11倍へ膨らむ（design-decisions.md 8.5）。
    // 膨張率の差を上限へ反映していることを固定する。
    expect(KATEX_LIMITS.perFormulaBytes).toBeLessThan(
      HIGHLIGHT_LIMITS.perBlockBytes,
    );
    expect(KATEX_LIMITS.perDocumentBytes).toBeLessThan(
      HIGHLIGHT_LIMITS.perDocumentBytes,
    );
  });
});

describe("plainDocumentReason", () => {
  /** 1行 `unit` を `count` 行並べた文書。 */
  const lines = (unit: string, count: number) => unit.repeat(count);
  /**
   * 「項目数 × 文字数」の上限に、ちょうど収まる最大の項目数（1項目5文字の `- a\n\n`）。
   * 項目の間に空行を挟み、1つのブロックが長くなりすぎないようにする。
   */
  const largestAllowedItems = Math.floor(
    Math.sqrt(DOCUMENT_LIMITS.richMaxListItemChars / 5),
  );

  const cases: [string, string, PlainDocumentReason | null][] = [
    // 説明, 本文, 理由
    ["空の文書", "", null],
    ["短い文書", "# 見出し\n\n本文。\n", null],
    [
      "文字数の上限ちょうど",
      lines("aaaaaaaa\n\n", DOCUMENT_LIMITS.richMaxChars / 10),
      null,
    ],
    [
      "文字数の上限を1文字超える",
      "a".repeat(DOCUMENT_LIMITS.richMaxChars + 1),
      "tooLong",
    ],
    [
      "10 MiB相当の長さは、項目を数えずに長さで判定する",
      lines("- a\n", 2_700_000),
      "tooLong",
    ],
    [
      "項目数 × 文字数がちょうど上限に収まる",
      lines("- a\n\n", largestAllowedItems),
      null,
    ],
    [
      "項目数 × 文字数が上限を1項目超える",
      lines("- a\n\n", largestAllowedItems + 1),
      "tooManyListItems",
    ],
    [
      "リストを含まない長い文書は、文字数の上限まで通る",
      lines("段落。\n\n", DOCUMENT_LIMITS.richMaxChars / 5),
      null,
    ],
  ];
  test.each(cases)("%s", (_name, text, expected) => {
    expect(plainDocumentReason(text)).toBe(expected);
  });

  test.each([
    // 説明, 1行, リスト項目として数えるか
    ["ハイフン", "- a\n", true],
    ["アスタリスク", "* a\n", true],
    ["プラス", "+ a\n", true],
    ["番号とピリオド", "1. a\n", true],
    ["番号とかっこ", "1) a\n", true],
    ["字下げした項目", "    - a\n", true],
    ["タブで字下げした項目", "\t- a\n", true],
    // 引用の中のリストもパーサーは項目として処理する（レビュー指摘）。
    ["引用の中のリスト", "> - a\n", true],
    ["二重の引用の中のリスト", "> > - a\n", true],
    ["空白のない引用の中のリスト", ">- a\n", true],
    ["引用の中の番号付きリスト", "> 1. a\n", true],
    ["字下げした引用の中のリスト", "  >   - a\n", true],
    ["同じ行に連なるマーカー", "- - a\n", true],
    ["番号付きとハイフンの連なり", "1. - a\n", true],
    ["マーカーの後に空白がない", "-a\n", false],
    ["強調（アスタリスク2つ）", "**a**\n", false],
    ["小数（番号ではない）", "1.5 a\n", false],
    ["10桁の数字（番号は9桁まで）", "1234567890. a\n", false],
    ["引用だけの行", "> a\n", false],
    ["引用の本文の途中にあるハイフン", "> a - b\n", false],
    ["ハイフンが連なるだけ（区切り線）", "---\n", false],
    ["段落", "aaa\n", false],
  ])("リスト項目の数え方: %s", (_name, line, counted) => {
    // 行の間に空行を挟み（1つのブロックが長くならない）、上限を超えるのに要る行数を並べる。
    const unit = `${line}\n`;
    const overLimit = Math.ceil(
      Math.sqrt(DOCUMENT_LIMITS.richMaxListItemChars / unit.length),
    );
    const text = lines(unit, overLimit + 1);
    expect(text.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.richMaxChars);
    expect(plainDocumentReason(text)).toBe(counted ? "tooManyListItems" : null);
  });

  test("同じ行に連なるマーカーは、1つずつ数える", () => {
    // `- - a\n\n` は7文字で、項目は2つ。1行1項目として数えると、2.5万行（17.5万文字、項目2.5万、
    // 積 4.4×10⁹）は上限内になる。1つずつ数えると、項目5万、積 8.8×10⁹ で上限を超える。
    expect(plainDocumentReason(lines("- - a\n\n", 25_000))).toBe(
      "tooManyListItems",
    );
  });

  test("引用の中のリストが上限を超えると、書式なしになる（レビュー指摘の再現）", () => {
    // 7万項目・49万文字（文字数の上限内）。数えないと、パースだけで約19秒かかる。
    expect(plainDocumentReason(lines("> - a\n\n", 70_000))).toBe(
      "tooManyListItems",
    );
  });

  test.each([
    // 説明, 本文
    ["マーカーだけが連なる1行", "- ".repeat(300_000)],
    ["引用の記号だけが連なる1行", ">".repeat(600_000)],
    ["引用とマーカーが交互に連なる1行", "> - ".repeat(150_000)],
    ["空白だけの1行", " ".repeat(600_000)],
    ["数字だけの1行", "1".repeat(600_000)],
    ["改行だけ", "\n".repeat(600_000)],
  ])("判定そのものが文書の長さに比例する時間で終わる: %s", (_name, text) => {
    // 接頭辞を後読みで確かめる正規表現は、これらの行で二乗になる。
    const started = performance.now();
    plainDocumentReason(text);
    expect(performance.now() - started).toBeLessThan(500);
  });

  test("長さの理由が先に判定される", () => {
    // 長く、かつ項目も多い文書は、項目を数える前に長さの理由で返る。
    const both = lines("- a\n", DOCUMENT_LIMITS.richMaxChars);
    expect(plainDocumentReason(both)).toBe("tooLong");
  });
});

describe("plainDocumentReason: 空行で区切られたブロックの長さ", () => {
  const limit = DOCUMENT_LIMITS.richMaxBlockChars;
  /** 行を、指定した文字数になるまで並べる。 */
  // 1行が48文字（改行を含めて49文字）のため、`limit` 文字で切ると、行の途中で終わる。
  // 末尾に改行を含めない。含めると、直後の行との間に空行ができてしまう。
  const block = (chars: number, line = "a".repeat(48)) =>
    `${line}\n`.repeat(Math.ceil(chars / (line.length + 1))).slice(0, chars);

  test.each([
    // 説明, 本文, 理由
    ["ブロックが上限ちょうど", block(limit), null],
    ["ブロックが上限を1文字超える", block(limit + 1), "tooLongBlock"],
    [
      "空行で区切れば、同じ長さのブロックがいくつ並んでも通る",
      Array.from({ length: 5 }, () => block(limit)).join("\n\n"),
      null,
    ],
    [
      "空白とタブだけの行も、ブロックを区切る",
      [block(limit), " \t ", block(limit)].join("\n"),
      null,
    ],
    ["改行のない長い1行", "a".repeat(limit + 1), "tooLongBlock"],
    [
      "表も、行が連なるブロックとして数える",
      `| a | b |\n| - | - |\n${"| 1 | 2 |\n".repeat(limit / 10)}`,
      "tooLongBlock",
    ],
    [
      "段落の前後の空行は、ブロックの長さに含めない",
      `\n\n\n${block(limit)}\n\n\n`,
      null,
    ],
  ] as [string, string, PlainDocumentReason | null][])(
    "%s",
    (_name, text, expected) => {
      expect(plainDocumentReason(text)).toBe(expected);
    },
  );

  test.each([
    // 説明, 本文
    [
      "バッククォートのフェンスの中も数える",
      `\`\`\`ts\n${block(limit + 1)}\n\`\`\`\n`,
    ],
    ["チルダのフェンスの中も数える", `~~~\n${block(limit + 1)}\n~~~\n`],
    ["閉じないフェンスの中も数える", `\`\`\`\n${block(limit + 1)}\n`],
  ])("フェンスコードの中も、ブロックの長さに数える: %s", (_name, text) => {
    // フェンスを見分けると、パーサーの状態（front matter、数式、HTMLブロック、引用、リスト）と
    // ずれて、長い段落を数え落とす。空行のない長いコードブロックは、書式なしになる。
    expect(plainDocumentReason(text)).toBe("tooLongBlock");
  });

  test("フェンスの中の空行は、ブロックを区切る", () => {
    // 空行を含むコードは、空行で区切られた短いブロックとして数える。
    const code = `${block(limit * 0.6)}\n\n${block(limit * 0.6)}`;
    expect(plainDocumentReason(`\`\`\`\n${code}\n\`\`\`\n`)).toBeNull();
  });

  test.each([
    // 説明, 本文
    [
      "4つのバッククォートのフェンスの中に、3つの行がある（レビュー指摘）",
      `\`\`\`\`\n\`\`\`\ncode\n\`\`\`\`\n${block(limit + 1)}\n`,
    ],
    [
      "情報文字列にバッククォートを含む開始の行（レビュー指摘）",
      `\`\`\`a\`b\n${"*a".repeat(55_000)}\n`,
    ],
    [
      "front matter の中に、閉じないフェンスに見える行がある",
      `---\nnote: |\n  \`\`\`\n---\n\n${block(limit + 1)}\n`,
    ],
    [
      "数式ブロックの中に、閉じないフェンスに見える行がある",
      `$$\n\`\`\`\n$$\n\n${block(limit + 1)}\n`,
    ],
    [
      "HTMLコメントの中に、閉じないフェンスに見える行がある",
      `<!--\n\`\`\`\n-->\n\n${block(limit + 1)}\n`,
    ],
  ])(
    "フェンスに見える行があっても、後続の長いブロックを数え落とさない: %s",
    (_name, text) => {
      expect(plainDocumentReason(text)).toBe("tooLongBlock");
    },
  );

  test("引用の中の長いブロックも数える", () => {
    expect(plainDocumentReason(`> ${"a".repeat(limit + 1)}\n`)).toBe(
      "tooLongBlock",
    );
  });

  test.each([
    // 説明, 本文
    ["フェンスの開始が交互に続く", "```\n".repeat(150_000)],
    ["空白だけの行が続く", "   \n".repeat(150_000)],
    ["長い1行", "a".repeat(590_000)],
    ["フェンスの文字が連なる1行", "`".repeat(590_000)],
  ])("判定そのものが文書の長さに比例する時間で終わる: %s", (_name, text) => {
    const started = performance.now();
    plainDocumentReason(text);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
