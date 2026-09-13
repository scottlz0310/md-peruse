import type { Root } from "hast";
import { type Components, toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { ReactElement } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeSanitize from "rehype-sanitize";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { HighlightedCodeBlock } from "../preview/HighlightedCodeBlock";
import type { ImageResource } from "../types/generated/ImageResource";
import type { IpcError } from "../types/generated/IpcError";
import { rehypeHeadingIds } from "./heading-id";
import { selectHighlightable } from "./highlight";
import { applyImageResources, collectImageReferences } from "./images";
import { rawHtmlHandlers } from "./raw-html";
import { sanitizeSchema } from "./sanitize-schema";

/**
 * 文書が参照する画像へresource IDを発行する関数（design-decisions.md 5.4）。
 *
 * IPCを呼ぶ実装は呼び出し側が渡す。パイプラインをIPCなしでテストするためである。
 */
export type ImageIssuer = (references: string[]) => Promise<ImageResource[]>;

/**
 * Markdownの基本パイプライン（design-decisions.md 8.1）の前半。hastを組み立てる。
 *
 * 数式は構文だけを解析する（`remark-math`）。KaTeXによる描画は遅延ロードとともに後続の
 * 単位で加えるため、それまで数式は `language-math` のコードとして表示される。解析だけを
 * 先に入れておくのは、KaTeXを加えたときに `$` を含む本文の解釈が変わらないようにするため
 * である。
 */
const toHast = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  // YAMLだけを対象とする。解析しないと本文の見出しとして誤描画される（8.1）。
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkRehype, { handlers: rawHtmlHandlers })
  .use(rehypeHeadingIds);

/** パイプラインの後半の入口。sanitizeより後ろでhastを変更するプラグインを足さない（8.2）。 */
const sanitize = unified().use(rehypeSanitize, sanitizeSchema);

/**
 * Markdownの本文をReact要素へ変換する。本文描画で `dangerouslySetInnerHTML` を使わない。
 *
 * 画像があれば、sanitizeの前に `issueImages` でまとめてresource IDを発行し、`src` を
 * 書き換える（5.4）。発行そのものが失敗した場合（ワークスペースを開いていないなど）は、
 * すべての画像の位置にその原因を示す。
 *
 * コードのハイライトは例外としてsanitizeの後にコンポーネント側で行う（8.2）。
 */
export async function renderMarkdown(
  markdown: string,
  issueImages: ImageIssuer,
): Promise<ReactElement> {
  const hast = await toHast.run(toHast.parse(markdown));
  const references = collectImageReferences(hast);
  if (references.length > 0) {
    const resources = await issueImages(references).catch(
      (error: IpcError): ImageResource[] =>
        references.map((reference) => ({
          status: "failed",
          reference,
          error,
        })),
    );
    applyImageResources(hast, resources);
  }
  const sanitized = (await sanitize.run(hast)) as Root;
  const highlightable = selectHighlightable(sanitized);
  const components: Partial<Components> = {
    // 画像を遅延して読み込む（7.3）。schemaへ `loading` と `decoding` を許可すると、値を
    // 絞る規則をもう1つ持つことになるため、sanitizeの後で固定の値を付ける。
    img: ({ node: _node, ...props }) =>
      jsx("img", { ...props, loading: "lazy", decoding: "async" }),
    // 失敗の表示をブロックの直後に置くため、`code` ではなく `pre` を差し替える（12章）。
    pre: ({ node, ...props }) => {
      const target = node === undefined ? undefined : highlightable.get(node);
      if (target === undefined) return jsx("pre", props);
      return jsx(HighlightedCodeBlock, target);
    },
  };
  return toJsxRuntime(sanitized, {
    Fragment,
    jsx,
    jsxs,
    components,
    passNode: true,
    // 表の桁揃えを `align` 属性のまま出す。既定では `style="text-align: ..."` へ変換され、
    // CSPの `style-src-attr 'none'` で無効になるうえ、sanitizeを通した後に `style` 属性を
    // 生む経路になる（5.5、8.2）。`align` はsanitize schemaが値まで絞って許可している。
    tableCellAlignToStyle: false,
  });
}
