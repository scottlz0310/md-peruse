import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { plainDocumentReason } from "./limits";
import { type ImageIssuer, renderMarkdown } from "./render";

/**
 * 不正な入力でも、描画パイプラインが例外を出さず、時間内に終わり、DOMへ描画できること。
 * dev-flow.md の Phase 4 完了条件「不正なMarkdownやMermaid入力でアプリが停止しない」の
 * うち、Markdownの側を固定する。Mermaidの側は、`mermaid.test.ts` と `MermaidDiagram.test.tsx` が、
 * 構文エラー、読込の失敗、時間切れで、理由を示すことを固定している。入力は、記法の未閉じ、壊れた文字、極端な入れ子、
 * 対にならない記号である。時間は、書式ありで描画する上限（60万文字）より小さい入力で、
 * 上限の判定に頼らず、パイプラインそのものが有限時間で終わることを確かめる。
 */

/** 画像の発行に失敗した応答。本文の描画は続くことが前提である。 */
const failingIssuer: ImageIssuer = () =>
  Promise.reject({ code: "workspaceNotFound", message: "失敗", detail: null });

afterEach(() => {
  cleanup();
});

const SIZE = 20_000;

/** 入力の名前と、`SIZE` 文字前後の入力を作る関数。 */
const cases: [string, (size: number) => string][] = [
  ["未閉じの角括弧", (n) => "[".repeat(n)],
  ["未閉じの画像記法", (n) => "![".repeat(n / 2)],
  ["未閉じのリンク先", (n) => "[a](b ".repeat(n / 6)],
  ["未閉じの強調", (n) => "*a ".repeat(n / 3)],
  ["未閉じのインラインコード", (n) => "`".repeat(n)],
  ["未閉じのフェンス", (n) => `\`\`\`ts\n${"let a;\n".repeat(n / 7)}`],
  ["閉じないHTMLの開始タグ", (n) => "<a ".repeat(n / 3)],
  ["閉じないHTMLコメント", (n) => `<!-- ${"a".repeat(n)}`],
  ["未閉じの数式", (n) => "$".repeat(n)],
  ["未閉じの数式ブロック", (n) => `$$\n${"x ".repeat(n / 2)}`],
  ["構文エラーの数式", (n) => "$\\frac{a$ ".repeat(n / 10)],
  ["バックスラッシュの連続", (n) => "\\".repeat(n)],
  ["深い引用", (n) => `${"> ".repeat(200)}a\n`.repeat(n / 403)],
  [
    "深いリストの入れ子",
    (n) =>
      Array.from({ length: 100 }, (_, i) => `${"  ".repeat(i)}- a\n`)
        .join("")
        .repeat(n / 10_000),
  ],
  [
    "列の数が合わない表",
    (n) => `| a | b |\n| - |\n${"| 1 | 2 | 3 | 4 |\n".repeat(n / 20)}`,
  ],
  ["区切り行のない表", (n) => "| a | b |\n".repeat(n / 10)],
  ["参照先の無い参照リンク", (n) => "[r] [s][t] ".repeat(n / 11)],
  ["重複する脚注の定義", (n) => `x[^a]\n\n${"[^a]: y\n\n".repeat(n / 9)}`],
  ["定義の無い脚注の参照", (n) => "x[^a][^b][^c] ".repeat(n / 14)],
  ["閉じないfront matter", (n) => `---\n${"key: value\n".repeat(n / 11)}`],
  ["不正なYAMLのfront matter", () => "---\n: : [\n  - {\n---\n\n本文\n"],
  ["NUL文字", (n) => "a\u0000b\n".repeat(n / 4)],
  ["対にならないサロゲート", (n) => "\uD800a\uDC00b".repeat(n / 4)],
  ["制御文字と双方向制御文字", (n) => "\u0001‮⁦​".repeat(n / 4)],
  ["CRだけの改行", (n) => "a\rb\r".repeat(n / 4)],
  ["改行のない長い1行", (n) => "a".repeat(n)],
  ["空の入力", () => ""],
  ["空白だけの入力", (n) => " \t\n".repeat(n / 3)],
  [
    "危険なURL scheme",
    (n) =>
      "[a](javascript:alert(1)) ![b](data:image/png;base64,AAAA) ".repeat(
        n / 60,
      ),
  ],
];

describe("不正な入力でも、描画パイプラインが例外を出さない", () => {
  test.each(cases)("%s", async (_name, make) => {
    const text = make(SIZE);
    const started = performance.now();
    const element = await renderMarkdown(text, failingIssuer);
    const { container } = render(element);
    const elapsed = performance.now() - started;

    expect(container).toBeDefined();
    // 記法の解析が二乗に伸びる入力（8.7）でも、この大きさでは数秒以内に終わる。
    expect(elapsed).toBeLessThan(5_000);
  });

  test("不正な入力のどれも、書式なしの判定で例外を出さない", () => {
    for (const [, make] of cases) {
      expect(() => plainDocumentReason(make(SIZE))).not.toThrow();
    }
  });
});
