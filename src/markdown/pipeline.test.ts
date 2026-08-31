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
import { anchorElementId, rehypeHeadingIds } from "./heading-id";
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
    // `rehype-katex` より前に置く。後ろだとMathMLのテキストと `annotation` の
    // LaTeXを二重に拾う（design-decisions.md 8.2）。
    .use(rehypeHeadingIds)
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

describe("見出しアンカー", () => {
  async function headingIds(markdown: string): Promise<string[]> {
    const tree = await render(markdown);
    return ["h1", "h2", "h3", "h4", "h5", "h6"]
      .flatMap((tagName) => collect(tree, tagName))
      .map((heading) => String(heading.properties?.id));
  }

  test.each([
    // Markdown, 期待するID
    ["# Getting Started", "user-content-getting-started"],
    ["# はじめに", "user-content-はじめに"],
    ["# API リファレンス (v2)", "user-content-api-リファレンス-v2"],
    // 見出しIDの生成を `rehype-katex` の前に置いた効果。後ろだと `x2x2` になる
    ["# 数式 $x^2$ を含む", "user-content-数式-x2-を含む"],
    ["# `code` を含む", "user-content-code-を含む"],
  ])("%s のIDは %s", async (markdown, expected) => {
    expect(await headingIds(markdown)).toEqual([expected]);
  });

  test("重複する見出しへ連番が付く", async () => {
    expect(await headingIds("# 概要\n\n# 概要\n\n# 概要\n")).toEqual([
      "user-content-概要",
      "user-content-概要-1",
      "user-content-概要-2",
    ]);
  });

  test("同一文書アンカーの遷移先が存在する", async () => {
    // remarkは断片をパーセントエンコードして出力するため、解決には復号が要る。
    const tree = await render("# はじめに\n\n[移動](#はじめに)\n");
    const [anchor] = collect(tree, "a");
    const href = String(anchor?.properties?.href);
    expect(href).toBe("#%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB");

    const target = anchorElementId(href.slice(1));
    expect(await headingIds("# はじめに\n")).toContain(String(target));
  });

  test("見出しと脚注のIDが衝突しない", async () => {
    // `# fn-1` のslugは脚注が使う `fn-1` と一致する。既存のIDを占有済みとして
    // 登録することで連番へ逃がす（design-decisions.md 7.2）。
    const tree = await render("# fn-1\n\n本文[^1]\n\n[^1]: 脚注\n");

    const ids: string[] = [];
    visit(tree, "element", (node: Element) => {
      const id = node.properties?.id;
      if (typeof id === "string") ids.push(id);
    });
    expect(new Set(ids).size).toBe(ids.length);

    // 脚注参照の遷移先は脚注本体であり、見出しではない。
    const [reference] = collect(tree, "a").filter(
      (anchor) => anchor.properties?.dataFootnoteRef !== undefined,
    );
    const target = String(reference?.properties?.href).slice(1);
    expect(collect(tree, "li")[0]?.properties?.id).toBe(target);
    expect(collect(tree, "h1")[0]?.properties?.id).not.toBe(target);
  });

  test.each([
    // 見出し（脚注のIDと同じslugになる）, 期待するID
    ["# fn-1", "user-content-fn-1-1"],
    ["# fnref-1", "user-content-fnref-1-1"],
  ])("%s は脚注を避けて %s になる", async (heading, expected) => {
    const tree = await render(`${heading}\n\n本文[^1]\n\n[^1]: 脚注\n`);
    expect(collect(tree, "h1")[0]?.properties?.id).toBe(expected);
  });

  test("脚注と同名の見出しへのリンクは脚注を指す", async () => {
    // 名前空間が同じである以上、`#fn-1` がどちらか一方しか指せない。脚注が先に
    // IDを取り、見出しは連番へ逃げる。DOMのID重複（脚注参照が見出しへ吸われる）
    // を防ぐことを優先した結果であり、この非対称は残る（design-decisions.md 7.2）。
    const tree = await render(
      "# fn-1\n\n[移動](#fn-1)\n\n本文[^1]\n\n[^1]: 脚注\n",
    );
    const [link] = collect(tree, "a").filter(
      (anchor) =>
        anchor.properties?.dataFootnoteRef === undefined &&
        anchor.properties?.dataFootnoteBackref === undefined,
    );
    const target = anchorElementId(String(link?.properties?.href).slice(1));
    expect(target).toBe("user-content-fn-1");
    expect(collect(tree, "li")[0]?.properties?.id).toBe(String(target));
    expect(collect(tree, "h1")[0]?.properties?.id).toBe("user-content-fn-1-1");
  });

  test.each([
    // 見出し, リンク先の断片
    ["# footnote-label", "footnote-label"],
    ["# はじめに", "%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB"],
  ])("%s は脚注が共存しても #%s から到達できる", async (heading, fragment) => {
    // 前置のない `footnote-label` は見出しのIDと別の名前空間にあり、占有登録の
    // 対象ではない。占有すると見出しが連番へ逃げ、`anchorElementId` の解決先と
    // 食い違う（design-decisions.md 7.2）。
    const tree = await render(
      `${heading}\n\n[移動](#${fragment})\n\n本文[^1]\n\n[^1]: 脚注\n`,
    );

    const [link] = collect(tree, "a").filter(
      (anchor) =>
        anchor.properties?.dataFootnoteRef === undefined &&
        anchor.properties?.dataFootnoteBackref === undefined,
    );
    const target = anchorElementId(String(link?.properties?.href).slice(1));
    expect(collect(tree, "h1")[0]?.properties?.id).toBe(String(target));

    const ids: string[] = [];
    visit(tree, "element", (node: Element) => {
      const id = node.properties?.id;
      if (typeof id === "string") ids.push(id);
    });
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("脚注ラベルのIDは前置されない", async () => {
    // `mdast-util-to-hast` が付けた `id` は上書きしない。
    // 上書きすると `aria-describedby` の参照先が失われる。
    const tree = await render("本文[^1]\n\n[^1]: 脚注\n");
    const [label] = collect(tree, "h2");
    expect(label?.properties?.id).toBe("footnote-label");
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
