import { describe, expect, test } from "bun:test";
import {
  HIGHLIGHT_LIMITS,
  highlightCost,
  KATEX_LIMITS,
  mathRenderCost,
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
