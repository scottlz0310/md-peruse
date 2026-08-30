import type { Element, Text } from "hast";
import type { Html, Parents } from "mdast";
import type { Options } from "remark-rehype";

type Handlers = NonNullable<Options["handlers"]>;

/**
 * Raw HTMLをソース文字列として出力する `remark-rehype` のhandler。
 *
 * `remark-rehype` は既定でRaw HTMLを破棄し、`allowDangerousHtml` と `rehype-raw`
 * を使えばmarkupとして解釈する。本アプリはそのどちらでもなく、書かれた文字列を
 * そのまま見せる（design-decisions.md 8.1）。mdastの `html` ノードをhastの
 * テキストへ写すことで、sanitizeを待たずにこの段階で要素化を断つ。
 *
 * block（`root`、`blockquote`、`listItem` 直下）は `pre > code` で包み、改行と
 * インデントを保持する。inline（`paragraph` 直下）は段落の流れを壊さないよう
 * 素のテキストとする。HTMLコメントも同じ扱いとし、例外を作らない。
 */
export const rawHtmlHandlers: Handlers = {
  html(_state, node: Html, parent: Parents | undefined): Text | Element {
    const text: Text = { type: "text", value: node.value };
    if (node.position) text.position = node.position;
    if (parent?.type === "paragraph") return text;

    const code: Element = {
      type: "element",
      tagName: "code",
      properties: {},
      children: [text],
    };
    const pre: Element = {
      type: "element",
      tagName: "pre",
      properties: {},
      children: [code],
    };
    if (node.position) pre.position = node.position;
    return pre;
  },
};
