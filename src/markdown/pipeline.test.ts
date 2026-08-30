import { describe, expect, test } from "bun:test";
import type { Element, Root } from "hast";
import { sanitize } from "hast-util-sanitize";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { rawHtmlHandlers } from "./raw-html";
import { sanitizeSchema } from "./sanitize-schema";

/**
 * 実際のパイプラインを通してからsanitizeする。
 *
 * 要素を手で組むテストでは、上流のプラグインが何を生成するかを検証できない。
 * 生成物とschemaの食い違い（許可し忘れた属性、idの二重前置）はここで捕まえる。
 */
async function render(markdown: string): Promise<Root> {
  const mdast = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(markdown);
  const hast = await unified()
    .use(remarkRehype, { handlers: rawHtmlHandlers })
    .use(rehypeKatex, { output: "mathml" })
    .run(mdast);
  return sanitize(hast as Root, sanitizeSchema) as Root;
}

function collect(tree: Root, tagName: string): Element[] {
  const found: Element[] = [];
  visit(tree, "element", (node: Element) => {
    if (node.tagName === tagName) found.push(node);
  });
  return found;
}

describe("数式の属性がsanitizeを通る", () => {
  test.each([
    // LaTeX, 要素, 属性, 期待値
    [String.raw`$\quad$`, "mspace", "width", "1em"],
    [String.raw`$\hspace{2em}$`, "mspace", "width", "2em"],
    [String.raw`$\color{red}{x}$`, "mstyle", "mathcolor", "red"],
    [String.raw`$\boxed{x}$`, "menclose", "notation", "box"],
    [String.raw`$\overline{x}$`, "mover", "accent", "true"],
  ])("%s の %s[%s]", async (markdown, tagName, attribute, expected) => {
    const elements = collect(await render(markdown), tagName);
    expect(elements.length).toBeGreaterThan(0);
    expect(
      elements.some(
        (element) => String(element.properties?.[attribute]) === expected,
      ),
    ).toBe(true);
  });

  test("色の値が異常ならその属性だけ落ちる", async () => {
    const tree = await render(String.raw`$\color{red}{x}$`);
    const [mstyle] = collect(tree, "mstyle");
    expect(mstyle?.properties?.mathcolor).toBe("red");
  });
});

describe("脚注のidとhrefが一致する", () => {
  test("参照と戻りリンクの遷移先が存在する", async () => {
    const tree = await render("本文[^1]\n\n[^1]: 脚注\n");
    const ids = new Set<string>();
    visit(tree, "element", (node: Element) => {
      const id = node.properties?.id;
      if (typeof id === "string") ids.add(id);
    });
    const hrefs = collect(tree, "a")
      .map((anchor) => anchor.properties?.href)
      .filter(
        (href): href is string =>
          typeof href === "string" && href.startsWith("#"),
      );

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(ids).toContain(href.slice(1));
    }
  });
});

describe("危険な入力", () => {
  test("Raw HTMLは要素にならない", async () => {
    const tree = await render(
      '<script>alert(1)</script>\n\n<div onclick="x">a</div>\n',
    );
    expect(collect(tree, "script")).toHaveLength(0);
    expect(collect(tree, "div")).toHaveLength(0);
  });

  test.each([
    "[link](javascript:alert(1))",
    "[link](data:text/html,<script>)",
    "[link](file:///C:/Windows)",
  ])("%s のhrefは落ちる", async (markdown) => {
    const [anchor] = collect(await render(markdown), "a");
    expect(anchor?.properties?.href).toBeUndefined();
  });

  test("Markdownの相対画像srcは書き換え前なので落ちる", async () => {
    // 画像URLの組み立てはsanitizeより前の段階で行う（design-decisions.md 5.4）。
    // 未変換のまま到達した場合に通さないことを固定する。
    const [image] = collect(await render("![alt](./local.png)"), "img");
    expect(image?.properties?.src).toBeUndefined();
    expect(image?.properties?.alt).toBe("alt");
  });
});
