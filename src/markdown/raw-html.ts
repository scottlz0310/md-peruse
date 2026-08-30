import type { Element, Text } from "hast";
import type { Html, Parents } from "mdast";
import type { Options } from "remark-rehype";

type Handlers = NonNullable<Options["handlers"]>;

/**
 * `html` ノードをblockとして扱う親。
 *
 * mdastはblockとinlineを同じ `html` ノードで表すため、親の種類で判別する。
 * ここに挙げた4種はflow contentを子に持つ（実測）。`heading`、`strong`、
 * `emphasis`、`delete`、`link`、`tableCell` などphrasing contentしか持てない
 * 親の下では、`pre` を返すとタグと本文が分断されるため列挙しない。
 * 未知の親はinlineとして扱い、要素の構造を壊さない側へ倒す。
 */
const BLOCK_PARENTS = new Set([
  "root",
  "blockquote",
  "listItem",
  "footnoteDefinition",
]);

/**
 * Raw HTMLをソース文字列として出力する `remark-rehype` のhandler。
 *
 * `remark-rehype` は既定でRaw HTMLを破棄し、`allowDangerousHtml` と `rehype-raw`
 * を使えばmarkupとして解釈する。本アプリはそのどちらでもなく、書かれた文字列を
 * そのまま見せる（design-decisions.md 8.1）。mdastの `html` ノードをhastの
 * テキストへ写すことで、sanitizeを待たずにこの段階で要素化を断つ。
 *
 * blockは `pre > code` で包み、改行とインデントを保持する。inlineは前後の
 * テキストの流れを壊さないよう素のテキストとする。HTMLコメントも同じ扱いとし、
 * 例外を作らない。
 */
export const rawHtmlHandlers: Handlers = {
  html(_state, node: Html, parent: Parents | undefined): Text | Element {
    const text: Text = { type: "text", value: node.value };
    if (node.position) text.position = node.position;
    if (!parent || !BLOCK_PARENTS.has(parent.type)) return text;

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
