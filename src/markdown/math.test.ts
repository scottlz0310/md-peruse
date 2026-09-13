import { describe, expect, mock, test } from "bun:test";
import type { Root } from "hast";
import { toText } from "hast-util-to-text";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { type KatexLoader, MATH_ERROR_CLASS, rehypeMath } from "./math";

async function toHast(markdown: string, loadKatex: KatexLoader): Promise<Root> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeMath, { loadKatex });
  return processor.run(processor.parse(markdown));
}

describe("rehypeMath", () => {
  test("数式のない文書ではKaTeXを読み込まない", async () => {
    const loadKatex = mock<KatexLoader>(() => {
      throw new Error("呼ばれない");
    });

    await toHast("# 見出し\n\n`code` と本文\n", loadKatex);

    expect(loadKatex).not.toHaveBeenCalled();
  });

  test("KaTeXを読み込めなければ、すべての数式の位置にソースと理由を示す（12章）", async () => {
    const tree = await toHast("$a$ と\n\n$$\nb\n$$\n", () =>
      Promise.reject(new Error("chunk load failed")),
    );

    const errors = tree.children
      .flatMap((node) =>
        node.type === "element" ? [node, ...node.children] : [],
      )
      .filter(
        (node) =>
          node.type === "element" &&
          Array.isArray(node.properties.className) &&
          node.properties.className.includes(MATH_ERROR_CLASS),
      );
    expect(errors.map((node) => toText(node))).toEqual([
      expect.stringContaining("chunk load failed"),
      expect.stringContaining("chunk load failed"),
    ]);
    expect(toText(errors[0] ?? tree)).toStartWith("a");
    expect(toText(errors[1] ?? tree)).toStartWith("b");
  });
});
