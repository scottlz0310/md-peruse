import { slug } from "github-slugger";
import type { Root } from "hast";
import { headingRank } from "hast-util-heading-rank";
import { toString as textContent } from "hast-util-to-string";
import { visit } from "unist-util-visit";

/**
 * 利用者由来のIDへ付ける前置。
 *
 * `mdast-util-to-hast` は脚注の `id` と `href` の双方にこの値を既に付けている。
 * 見出しへも同じ前置を適用し、文書由来のIDをこの前置の下へまとめる
 * （design-decisions.md 8.2）。
 */
export const HEADING_ID_PREFIX = "user-content-";

/**
 * 見出しへIDを付ける `rehype` プラグイン。
 *
 * `rehype-slug` を使わないのは、同プラグインが既存のIDを重複回避の対象へ含めない
 * ためである。脚注は `mdast-util-to-hast` が `user-content-fn-1` のようなIDを先に
 * 付けており、`# fn-1` という見出しが同じ文書にあると同一のIDが2つ生成される。
 * 文書順で先にある見出しが `getElementById` に拾われ、脚注参照が脚注へ到達できない
 * （design-decisions.md 7.2）。
 *
 * 木を2度走査し、1度目で既存のIDをそのまま使用済みとして集め、2度目で見出しへ
 * 付与する。これにより `# fn-1` は `user-content-fn-1-1` となり、脚注の
 * `user-content-fn-1` と衝突しない。既存のIDを持つ見出し（脚注セクションの
 * `footnote-label`）は上書きしない。上書きすると `aria-describedby` の参照先が
 * 失われる。
 *
 * 既存のIDはslug化せず、生成した候補IDと完全一致で比較する。IDの一部をslug化して
 * 比べると、実在しないIDを占有してしまう。`[^a.b]` の脚注は `user-content-fn-a.b`
 * というIDを持つが、`fn-a.b` をslug化すると `fn-ab` になる。これを占有すると
 * `# fn-ab` の見出しが `user-content-fn-ab-1` へずれる一方、`#fn-ab` は
 * `user-content-fn-ab` へ解決されるため、リンクが見出しへ到達しない
 * （design-decisions.md 7.2）。
 *
 * 見出し同士の重複も同じ集合で回避するため、採番は1か所に閉じる。slug規則は
 * GitHub互換（`github-slugger`）であり、日本語の文字は保持され、半角空白はハイフンへ、
 * 重複は連番で回避される。
 */
export function rehypeHeadingIds() {
  return (tree: Root): undefined => {
    const used = new Set<string>();

    visit(tree, "element", (node) => {
      const id = node.properties.id;
      if (typeof id === "string") used.add(id);
    });

    visit(tree, "element", (node) => {
      if (headingRank(node) === undefined) return;
      if (node.properties.id !== undefined) return;
      node.properties.id = uniqueId(
        HEADING_ID_PREFIX + slug(textContent(node)),
        used,
      );
    });
  };
}

/** 使用済みのIDと重ならない候補を返し、その候補を使用済みへ加える。 */
function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  for (let counter = 1; used.has(candidate); counter += 1) {
    candidate = `${base}-${counter}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * 同一文書内アンカーの遷移先となる要素のIDを返す。
 *
 * `rehype-sanitize` は `href` を書き換えないため、リンクの断片は前置を持たない。
 * ここで前置を補って、見出しへ付けたIDと対応させる。
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
