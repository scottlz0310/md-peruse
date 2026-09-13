import type { ReactElement } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeReact from "rehype-react";
import rehypeSanitize from "rehype-sanitize";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { rehypeHeadingIds } from "./heading-id";
import { rawHtmlHandlers } from "./raw-html";
import { sanitizeSchema } from "./sanitize-schema";

/**
 * Markdownの基本パイプライン（design-decisions.md 8.1）。
 *
 * 本文をReact要素として組み立て、`dangerouslySetInnerHTML` を使わない。sanitizeは
 * React要素へ変換する直前に置き、それより後ろでhastを変更するプラグインを足さない。
 *
 * 数式は構文だけを解析する（`remark-math`）。KaTeXによる描画は遅延ロードとともに後続の
 * 単位で加えるため、それまで数式は `language-math` のコードとして表示される。解析だけを
 * 先に入れておくのは、KaTeXを加えたときに `$` を含む本文の解釈が変わらないようにするため
 * である。
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  // YAMLだけを対象とする。解析しないと本文の見出しとして誤描画される（8.1）。
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkRehype, { handlers: rawHtmlHandlers })
  .use(rehypeHeadingIds)
  .use(rehypeSanitize, sanitizeSchema)
  // 表の桁揃えを `align` 属性のまま出す。既定では `style="text-align: ..."` へ変換され、
  // CSPの `style-src-attr 'none'` で無効になるうえ、sanitizeを通した後に `style` 属性を
  // 生む経路になる（5.5、8.2）。`align` はsanitize schemaが値まで絞って許可している。
  .use(rehypeReact, { Fragment, jsx, jsxs, tableCellAlignToStyle: false });

/** Markdownの本文をReact要素へ変換する。 */
export async function renderMarkdown(markdown: string): Promise<ReactElement> {
  const file = await processor.process(markdown);
  return file.result;
}
