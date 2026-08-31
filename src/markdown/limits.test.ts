import { describe, expect, test } from "bun:test";
import {
  HIGHLIGHT_LIMITS,
  KATEX_LIMITS,
  shouldHighlight,
  shouldRenderMath,
} from "./limits";

describe("shouldRenderMath", () => {
  test.each([
    // 説明, 1数式のサイズ, 描画済みの合計, 描画するか
    ["上限ちょうどの数式", KATEX_LIMITS.perFormulaBytes, 0, true],
    ["上限を1バイト超える数式", KATEX_LIMITS.perFormulaBytes + 1, 0, false],
    [
      "合計が上限ちょうどになる",
      KATEX_LIMITS.perFormulaBytes,
      KATEX_LIMITS.perDocumentBytes - KATEX_LIMITS.perFormulaBytes,
      true,
    ],
    [
      "合計が上限を1バイト超える",
      KATEX_LIMITS.perFormulaBytes,
      KATEX_LIMITS.perDocumentBytes - KATEX_LIMITS.perFormulaBytes + 1,
      false,
    ],
    [
      "合計が尽きていれば小さな数式も描画しない",
      1,
      KATEX_LIMITS.perDocumentBytes,
      false,
    ],
    ["通常の数式", 200, 0, true],
  ])("%s", (_name, formulaBytes, renderedBytes, expected) => {
    expect(shouldRenderMath(formulaBytes, renderedBytes)).toBe(expected);
  });
});

describe("shouldHighlight", () => {
  test.each([
    // 説明, 1ブロックのサイズ, ハイライト済みの合計, ハイライトするか
    ["上限ちょうどのブロック", HIGHLIGHT_LIMITS.perBlockBytes, 0, true],
    [
      "上限を1バイト超えるブロック",
      HIGHLIGHT_LIMITS.perBlockBytes + 1,
      0,
      false,
    ],
    [
      "合計が上限ちょうどになる",
      HIGHLIGHT_LIMITS.perBlockBytes,
      HIGHLIGHT_LIMITS.perDocumentBytes - HIGHLIGHT_LIMITS.perBlockBytes,
      true,
    ],
    [
      "合計が上限を1バイト超える",
      HIGHLIGHT_LIMITS.perBlockBytes,
      HIGHLIGHT_LIMITS.perDocumentBytes - HIGHLIGHT_LIMITS.perBlockBytes + 1,
      false,
    ],
    ["通常のブロック", 2_000, 0, true],
  ])("%s", (_name, blockBytes, highlightedBytes, expected) => {
    expect(shouldHighlight(blockBytes, highlightedBytes)).toBe(expected);
  });
});

describe("上限どうしの関係", () => {
  test.each([
    // 説明, 1単位の上限, 文書の上限
    ["数式", KATEX_LIMITS.perFormulaBytes, KATEX_LIMITS.perDocumentBytes],
    [
      "コードブロック",
      HIGHLIGHT_LIMITS.perBlockBytes,
      HIGHLIGHT_LIMITS.perDocumentBytes,
    ],
  ])(
    "%s は1単位の上限が文書の上限を超えない",
    (_name, perUnit, perDocument) => {
      // 逆転すると、単体では上限内の入力が1つも処理できなくなる。
      expect(perUnit).toBeLessThanOrEqual(perDocument);
    },
  );

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
