#!/usr/bin/env bun
// GitHub Pages へ公開するページを生成する。
// 公開するのはプライバシーポリシーだけで、本文の正本は docs/privacy-policy.md とする
// （docs/store-submission.md 5章、design-decisions.md 13.7）。HTMLは、この正本から
// 都度生成する。リポジトリへはコミットせず、別の本文を持たない。
// 生成物は site/ へ出力し、.github/workflows/pages.yml が公開する。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { slug } from "github-slugger";
import type { Element, ElementContent, Root } from "hast";
import { toString as textContent } from "hast-util-to-string";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repositoryRoot, "docs", "privacy-policy.md");
const outputDirectory = join(repositoryRoot, "site");

const PAGE_TITLE = "プライバシーポリシー / Privacy Policy — md-peruse";

// 日本語と英語を1つの文書に並べる。目次のリンク（#日本語、#english）が使えるよう、
// 見出しへGitHubと同じ規則でIDを付ける。
function addHeadingIds() {
  return (tree: Root) => {
    const used = new Map<string, number>();
    visit(tree, "element", (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) {
        return;
      }
      const base = slug(textContent(node));
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      node.properties = {
        ...node.properties,
        id: count === 0 ? base : `${base}-${count}`,
      };
    });
  };
}

// 英語の節（見出し「English」から末尾まで）を `lang="en"` の section で囲む。
// スクリーンリーダーが読み上げの言語を切り替えられる。文書全体は `lang="ja"` とする。
function wrapEnglishSection() {
  return (tree: Root) => {
    const start = tree.children.findIndex(
      (node) =>
        node.type === "element" &&
        node.tagName === "h2" &&
        node.properties?.id === "english",
    );
    if (start === -1) {
      throw new Error("英語の節（## English）が見つかりません");
    }
    const section: Element = {
      type: "element",
      tagName: "section",
      properties: { lang: "en" },
      // 見出し以降は、本文の要素と空白の文字だけで、doctype は含まない。
      children: tree.children.splice(start) as ElementContent[],
    };
    tree.children.push(section);
  };
}

const STYLE = `
:root { color-scheme: light dark; }
body {
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
  max-width: 46rem;
  line-height: 1.75;
  font-family: system-ui, -apple-system, "Segoe UI", "Yu Gothic UI", "Meiryo UI", sans-serif;
}
h1, h2, h3 { line-height: 1.3; }
h2 { margin-top: 2.5rem; padding-bottom: .3rem; border-bottom: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { border: 1px solid color-mix(in srgb, currentColor 25%, transparent); padding: .4rem .6rem; text-align: left; vertical-align: top; }
code { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: .92em; }
hr { border: 0; border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent); margin: 2.5rem 0; }
a { overflow-wrap: anywhere; }
`.trim();

/** プライバシーポリシーのMarkdownから、公開するHTMLの文書を作る。 */
export function renderPrivacyPolicyPage(markdown: string): string {
  const body = String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      // 生のHTMLは通さない（正本はMarkdownだけで書く）。
      .use(remarkRehype)
      .use(addHeadingIds)
      .use(wrapEnglishSection)
      .use(rehypeStringify)
      .processSync(markdown),
  );
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${PAGE_TITLE}</title>
<style>
${STYLE}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

// ルートのURLでも到達できるよう、ポリシーのページへ転送する。
export function renderIndexPage(): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=privacy-policy.html">
<link rel="canonical" href="privacy-policy.html">
<title>${PAGE_TITLE}</title>
</head>
<body>
<p><a href="privacy-policy.html">プライバシーポリシー / Privacy Policy</a></p>
</body>
</html>
`;
}

if (import.meta.main) {
  const markdown = readFileSync(sourcePath, "utf-8");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    join(outputDirectory, "privacy-policy.html"),
    renderPrivacyPolicyPage(markdown),
    "utf-8",
  );
  writeFileSync(
    join(outputDirectory, "index.html"),
    renderIndexPage(),
    "utf-8",
  );
  console.log(
    `${outputDirectory} へ privacy-policy.html と index.html を生成しました`,
  );
}
