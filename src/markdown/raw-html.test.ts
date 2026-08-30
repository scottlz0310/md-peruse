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

function collect(nodes: RootContent[], tagName: string): Element[] {
  const found: Element[] = [];
  for (const node of nodes) {
    if (node.type !== "element") continue;
    if (node.tagName === tagName) found.push(node);
    found.push(...collect(node.children, tagName));
  }
  return found;
}

/** ツリー全体のテキストを出現順に連結する。 */
function textOf(nodes: RootContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return (node as Text).value;
      if (node.type === "element") return textOf(node.children);
      return "";
    })
    .join("");
}

/** `pre > code` の中身を取り出す。 */
function preSource(node: Element | undefined): string | undefined {
  if (!node) return undefined;
  const [code] = node.children;
  if (!code || !isElement(code, "code")) return undefined;
  return textOf(code.children);
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
    ["blockquote直下", "> <div>a</div>\n", "<div>a</div>"],
    ["listItem直下", "- <div>a</div>\n", "<div>a</div>"],
    [
      "footnoteDefinition直下",
      "本文[^1]\n\n[^1]: <div>a</div>\n",
      "<div>a</div>",
    ],
  ])("%s", async (_name, markdown, expected) => {
    const pres = collect((await toHast(markdown)).children, "pre");
    expect(pres).toHaveLength(1);
    expect(preSource(pres[0])).toBe(expected);
  });
});

describe("phrasing content内のRaw HTMLはテキストになる", () => {
  test.each([
    // 名前, Markdown, 期待する連結テキスト
    ["paragraph", "text a <b>bold</b> c\n", "text a <b>bold</b> c"],
    ["heading", "# hi <b>x</b>\n", "hi <b>x</b>"],
    ["strong", "**a <b>x</b>**\n", "a <b>x</b>"],
    ["emphasis", "*a <b>x</b>*\n", "a <b>x</b>"],
    ["delete", "~~a <b>x</b>~~\n", "a <b>x</b>"],
    ["link", "[a <b>x</b>](http://example.com)\n", "a <b>x</b>"],
    ["tableCell", "| a |\n| --- |\n| <b>x</b> |\n", "<b>x</b>"],
    [
      "自己終了タグ",
      'a <img src=x onerror="alert(1)"> b\n',
      'a <img src=x onerror="alert(1)"> b',
    ],
    ["インラインのコメント", "a <!-- memo --> b\n", "a <!-- memo --> b"],
  ])("%s では分断されない", async (_name, markdown, expected) => {
    const tree = await toHast(markdown);
    expect(collect(tree.children, "pre")).toHaveLength(0);
    expect(textOf(tree.children)).toContain(expected);
  });

  test.each([
    // 名前, Markdown, 分断されてはいけない要素
    ["heading", "# hi <b>x</b>\n", "h1"],
    ["strong", "**a <b>x</b>**\n", "strong"],
    ["link", "[a <b>x</b>](http://example.com)\n", "a"],
    ["tableCell", "| a |\n| --- |\n| <b>x</b> |\n", "td"],
  ])("%s の子はテキストだけになる", async (_name, markdown, tagName) => {
    const [element] = collect((await toHast(markdown)).children, tagName);
    expect(element).toBeDefined();
    expect(element?.children.every((child) => child.type === "text")).toBe(
      true,
    );
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
      const pres = collect(tree.children, "pre");
      expect(pres).toHaveLength(1);
      expect(preSource(pres[0])).toBe(expected);
    },
  );

  test("見出し内のinline HTMLはsanitize後もh1のまま残る", async () => {
    const tree = sanitize(
      await toHast("# hi <b>x</b>\n"),
      sanitizeSchema,
    ) as Root;
    const [heading] = collect(tree.children, "h1");
    expect(heading).toBeDefined();
    expect(textOf(tree.children)).toContain("hi <b>x</b>");
    expect(collect(tree.children, "pre")).toHaveLength(0);
  });
});
