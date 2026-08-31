import type { Options as RehypeSlugOptions } from "rehype-slug";

/**
 * 利用者由来のIDへ付ける前置。
 *
 * `mdast-util-to-hast` は脚注の `id` と `href` の双方へこの値を既に付けている。
 * 見出しへも同じ前置を適用し、文書由来のIDをこの前置の下へまとめる
 * （design-decisions.md 8.2）。前置がないと、`## footnote-label` のような見出しが
 * 脚注ラベルのIDと衝突する。
 */
export const HEADING_ID_PREFIX = "user-content-";

/**
 * `rehype-slug` へ渡すオプション。
 *
 * `rehype-slug` は既定では前置しないため、`prefix` で明示する。パイプラインでの
 * 位置は `rehype-katex` より前とする。後ろに置くと、KaTeXが生成するMathMLの
 * テキストと `annotation` のLaTeXを二重に拾い、`$x^2$` を含む見出しのIDが
 * `数式-x2x2-…` となる（実測。design-decisions.md 8.2）。
 */
export const headingSlugOptions: RehypeSlugOptions = {
  prefix: HEADING_ID_PREFIX,
};

/**
 * 同一文書内アンカーの遷移先となる要素のIDを返す。
 *
 * `rehype-sanitize` は `href` を書き換えないため、リンクの断片は前置を持たない。
 * ここで前置を補って、`rehype-slug` が付けた見出しのIDと対応させる。
 *
 * 断片は `mdast-util-to-hast` がパーセントエンコードして出力するため、復号してから
 * 前置する。復号できない断片は遷移先を特定できないものとして `null` を返す。
 */
export function anchorElementId(fragment: string): string | null {
  if (fragment === "") return null;
  const decoded = decodeFragment(fragment);
  return decoded === null ? null : HEADING_ID_PREFIX + decoded;
}

/**
 * 脚注の相互参照リンクの遷移先となる要素のIDを返す。
 *
 * 脚注のIDと `href` は `mdast-util-to-hast` が前置済みで対応しているため、
 * ここでは前置しない。呼び出し側は `data-footnote-ref` と `data-footnote-backref`
 * 属性でこの経路を選ぶ（design-decisions.md 7.2）。
 */
export function footnoteElementId(fragment: string): string | null {
  if (fragment === "") return null;
  return decodeFragment(fragment);
}

function decodeFragment(fragment: string): string | null {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return null;
  }
}
