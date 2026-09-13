import type { ReactElement } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeReact, { type Components } from "rehype-react";
import rehypeSanitize from "rehype-sanitize";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import type { ImageResource } from "../types/generated/ImageResource";
import type { IpcError } from "../types/generated/IpcError";
import { rehypeHeadingIds } from "./heading-id";
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

/**
 * 画像を遅延して読み込む（7.3）。
 *
 * sanitizeの後で固定の値を付ける。schemaへ `loading` と `decoding` を許可すると、
 * 値を絞る規則をもう1つ持つことになる。
 */
const components: Partial<Components> = {
  img: (props) => jsx("img", { ...props, loading: "lazy", decoding: "async" }),
};

/**
 * パイプラインの後半。sanitizeしてReact要素にする。本文描画で `dangerouslySetInnerHTML` を
 * 使わない。sanitizeより後ろでhastを変更するプラグインを足さない。
 */
const toReact = unified()
  .use(rehypeSanitize, sanitizeSchema)
  // 表の桁揃えを `align` 属性のまま出す。既定では `style="text-align: ..."` へ変換され、
  // CSPの `style-src-attr 'none'` で無効になるうえ、sanitizeを通した後に `style` 属性を
  // 生む経路になる（5.5、8.2）。`align` はsanitize schemaが値まで絞って許可している。
  .use(rehypeReact, {
    Fragment,
    jsx,
    jsxs,
    components,
    tableCellAlignToStyle: false,
  });

/**
 * Markdownの本文をReact要素へ変換する。
 *
 * 画像があれば、sanitizeの前に `issueImages` でまとめてresource IDを発行し、`src` を
 * 書き換える（5.4）。発行そのものが失敗した場合（ワークスペースを開いていないなど）は、
 * すべての画像の位置にその原因を示す。
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
  return toReact.stringify(await toReact.run(hast));
}
