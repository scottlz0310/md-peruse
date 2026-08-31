import { describe, expect, test } from "bun:test";
import type { Element, Root, Text } from "hast";
import { sanitize } from "hast-util-sanitize";
import rehypeKatex from "rehype-katex";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { anchorElementId, rehypeHeadingIds } from "./heading-id";
import { KATEX_LIMITS, KATEX_OUTPUT_EXPANSION_RATIO } from "./limits";
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
    // YAMLだけを対象とする。解析しないと本文の見出しとして誤描画される
    // （design-decisions.md 8.1）。
    .use(remarkFrontmatter, ["yaml"])
    .parse(markdown);
  const hast = await unified()
    .use(remarkRehype, { handlers: rawHtmlHandlers })
    // `rehype-katex` より前に置く。後ろだとMathMLのテキストと `annotation` の
    // LaTeXを二重に拾う（design-decisions.md 8.2）。
    .use(rehypeHeadingIds)
    .use(rehypeKatex, { output: "mathml", ...KATEX_LIMITS })
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

function textOf(tree: Root): string {
  let text = "";
  visit(tree, "text", (node: Text) => {
    text += node.value;
  });
  return text;
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

describe("数式の処理上限", () => {
  test.each([
    // LaTeX, 制限される属性
    [String.raw`$\rule{100em}{100em}$`, "width"],
    [String.raw`$\rule{100em}{100em}$`, "height"],
    [String.raw`$\hspace{500em}$`, "width"],
  ])("%s の %s が maxSize で制限される", async (markdown, attribute) => {
    const [mspace] = collect(await render(markdown), "mspace");
    expect(mspace?.properties?.[attribute]).toBe(`${KATEX_LIMITS.maxSize}em`);
  });

  test("raiseboxのvoffsetはmaxSizeの対象外である", async () => {
    // KaTeX側の制限であり本アプリでは塞げない（design-decisions.md 8.5）。
    // 塞げるようになったらこのテストが失敗し、方針を見直す契機になる。
    const [mpadded] = collect(
      await render(String.raw`$\raisebox{500em}{x}$`),
      "mpadded",
    );
    expect(mpadded?.properties?.voffset).toBe("500em");
  });

  test("マクロ展開の爆発がmaxExpandで停止する", async () => {
    // 4段の展開は10^4文字規模になりうるが、maxExpandで止まりエラー表示に変わる。
    const tree = await render(
      String.raw`$\def\a{aaaaaaaaaa}\def\b{\a\a\a\a\a\a\a\a\a\a}\def\c{\b\b\b\b\b\b\b\b\b\b}\def\d{\c\c\c\c\c\c\c\c\c\c}\d$`,
    );
    expect(textOf(tree).length).toBeLessThan(1_000);
  });

  test("無限再帰マクロが停止する", async () => {
    const tree = await render(String.raw`$\def\a{\a}\a$`);
    expect(textOf(tree).length).toBeLessThan(1_000);
  });

  test("上限サイズの数式の出力が想定の膨張率に収まる", async () => {
    // KaTeXの出力は入力の約11倍へ膨らむ。上限値はこの倍率を前提に決めており、
    // 倍率が上振れすると上限内でもDOMが重くなる（design-decisions.md 8.5）。
    const formula = "x+".repeat(KATEX_LIMITS.perFormulaBytes / 2);
    const tree = await render(`$${formula}x$`);

    let elements = 0;
    visit(tree, "element", () => {
      elements += 1;
    });
    expect(elements).toBeLessThan(
      formula.length * KATEX_OUTPUT_EXPANSION_RATIO,
    );
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
    // 見出し, リンク先の断片, 脚注のラベル
    ["# footnote-label", "footnote-label", "1"],
    ["# はじめに", "%E3%81%AF%E3%81%98%E3%82%81%E3%81%AB", "1"],
    // 記号を含むラベルの実IDは `user-content-fn-a.b`。slug化して比べると `fn-ab` を
    // 占有し、実在しないIDのせいで見出しがずれる（design-decisions.md 7.2）。
    ["# fn-ab", "fn-ab", "a.b"],
  ])(
    "%s は脚注[^%s]が共存しても #%s から到達できる",
    async (heading, fragment, label) => {
      // 脚注のIDと見出しの候補IDは完全一致でのみ衝突する。一部をslug化して比べると
      // 実在しないIDを占有し、見出しが連番へ逃げて `anchorElementId` の解決先と
      // 食い違う（design-decisions.md 7.2）。
      const tree = await render(
        `${heading}\n\n[移動](#${fragment})\n\n本文[^${label}]\n\n[^${label}]: 脚注\n`,
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
    },
  );

  test("脚注ラベルのIDは前置されない", async () => {
    // `mdast-util-to-hast` が付けた `id` は上書きしない。
    // 上書きすると `aria-describedby` の参照先が失われる。
    const tree = await render("本文[^1]\n\n[^1]: 脚注\n");
    const [label] = collect(tree, "h2");
    expect(label?.properties?.id).toBe("footnote-label");
  });
});

describe("YAML front matter", () => {
  test("本文から除かれる", async () => {
    // 解析しないと `---` が水平線、中身が setext 見出しとして描画され、
    // 見出しIDまで付く（design-decisions.md 8.1）。
    const tree = await render(
      "---\ntitle: 値\ntags: [a, b]\n---\n\n# 見出し\n\n本文。\n",
    );
    expect(textOf(tree)).not.toContain("値");
    expect(collect(tree, "hr")).toHaveLength(0);
    expect(collect(tree, "h2")).toHaveLength(0);
    expect(collect(tree, "h1")).toHaveLength(1);
  });

  test("空のfront matterも本文へ出ない", async () => {
    const tree = await render("---\n---\n\n# 見出し\n");
    expect(collect(tree, "hr")).toHaveLength(0);
    expect(collect(tree, "h1")).toHaveLength(1);
  });

  test.each([
    // 説明, Markdown
    ["前に空行がある", "\n---\ntitle: 値\n---\n\n本文\n"],
    ["閉じられていない", "---\ntitle: 値\n\n本文\n"],
    ["文書の途中にある", "# 見出し\n\n---\ntitle: 値\n---\n\n本文\n"],
    ["TOML形式である", "+++\ntitle = 値\n+++\n\n本文\n"],
  ])("%s ブロックは本文に残る", async (_name, markdown) => {
    // front matterとして扱う範囲は文書の先頭のYAMLブロックに限る。
    // 対象外のブロックを黙って消すと、本文の記述が失われる。
    expect(textOf(await render(markdown))).toContain("値");
  });

  test.each([
    // 説明, Markdown, 残る要素
    ["段落に続く `---` は水平線になる", "本文\n\n---\n\n次の段落\n", "hr"],
    [
      "`見出し` に続く `---` はsetext見出しになる",
      "見出し\n---\n\n本文\n",
      "h2",
    ],
  ])("%s", async (_name, markdown, tagName) => {
    expect(collect(await render(markdown), tagName)).toHaveLength(1);
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
