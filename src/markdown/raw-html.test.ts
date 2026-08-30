import { describe, expect, test } from "bun:test";
import type { Element, Root, RootContent, Text } from "hast";
import { sanitize } from "hast-util-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { rawHtmlHandlers } from "./raw-html";
import { sanitizeSchema } from "./sanitize-schema";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { handlers: rawHtmlHandlers });

async function toHast(markdown: string): Promise<Root> {
  return (await processor.run(processor.parse(markdown))) as Root;
}

function isElement(node: RootContent, tagName: string): node is Element {
  return node.type === "element" && node.tagName === tagName;
}

/** `pre > code` の中身を取り出す。 */
function preSource(node: RootContent | undefined): string | undefined {
  if (!node || !isElement(node, "pre")) return undefined;
  const [code] = node.children;
  if (!code || !isElement(code, "code")) return undefined;
  return code.children
    .filter((child): child is Text => child.type === "text")
    .map((child) => child.value)
    .join("");
}

describe("blockのRaw HTMLはpre/codeになる", () => {
  test.each([
    // 名前, Markdown, 期待するソース文字列
    ["root直下", "<div>a</div>\n", "<div>a</div>"],
    [
      "複数行",
      "<div>\n  <span>a</span>\n</div>\n",
      "<div>\n  <span>a</span>\n</div>",
    ],
    ["script", "<script>alert(1)</script>\n", "<script>alert(1)</script>"],
    ["コメント", "<!-- secret -->\n", "<!-- secret -->"],
  ])("%s", async (_name, markdown, expected) => {
    const tree = await toHast(markdown);
    expect(preSource(tree.children[0])).toBe(expected);
  });

  test.each([
    // 名前, Markdown
    ["blockquote直下", "> <div>a</div>\n"],
    ["listItem直下", "- <div>a</div>\n"],
  ])("%s", async (_name, markdown) => {
    const tree = await toHast(markdown);
    const found: Element[] = [];
    const walk = (nodes: RootContent[]): void => {
      for (const node of nodes) {
        if (node.type !== "element") continue;
        if (node.tagName === "pre") found.push(node);
        walk(node.children);
      }
    };
    walk(tree.children);
    expect(found).toHaveLength(1);
    expect(preSource(found[0])).toBe("<div>a</div>");
  });
});

describe("inlineのRaw HTMLは段落内のテキストになる", () => {
  test.each([
    // 名前, Markdown, 期待する段落のテキスト
    ["開きタグと閉じタグ", "text a <b>bold</b> c\n", "text a <b>bold</b> c"],
    [
      "自己終了タグ",
      'a <img src=x onerror="alert(1)"> b\n',
      'a <img src=x onerror="alert(1)"> b',
    ],
    ["コメント", "a <!-- memo --> b\n", "a <!-- memo --> b"],
  ])("%s", async (_name, markdown, expected) => {
    const [paragraph] = (await toHast(markdown)).children;
    expect(paragraph && isElement(paragraph, "p")).toBe(true);
    const element = paragraph as Element;
    expect(element.children.every((child) => child.type === "text")).toBe(true);
    expect(
      element.children
        .filter((child): child is Text => child.type === "text")
        .map((child) => child.value)
        .join(""),
    ).toBe(expected);
  });
});

describe("sanitize後もソース表示が残る", () => {
  test.each([
    // 名前, Markdown, 期待するソース文字列
    ["block", '<div onclick="x">a</div>\n', '<div onclick="x">a</div>'],
    ["script", "<script>alert(1)</script>\n", "<script>alert(1)</script>"],
  ])(
    "%s は要素にならずテキストとして残る",
    async (_name, markdown, expected) => {
      const tree = sanitize(await toHast(markdown), sanitizeSchema) as Root;
      expect(preSource(tree.children[0])).toBe(expected);
    },
  );
});
