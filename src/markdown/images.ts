import type { Element, ElementContent, Root } from "hast";
import { visit } from "unist-util-visit";
import type { ImageResource } from "../types/generated/ImageResource";

/**
 * 画像用custom protocolのオリジン（design-decisions.md 5.4、13.4）。sanitize schemaの
 * `img` の `src` の許可パターンと同じ前提に立つ。
 */
export const IMAGE_RESOURCE_ORIGIN = "http://mdperuse-img.localhost";

/** 画像を表示できなかった位置に置く要素のクラス。 */
export const IMAGE_ERROR_CLASS = "image-error";

/**
 * 本文中の画像参照を、重複を除いて出現順に集める。
 *
 * 参照はhastの `src` をそのまま使う。`remark-rehype` はMarkdownに書かれたURLを
 * パーセントエンコードして出力するが、Rust側の解決（`src-tauri/src/image/reference.rs`）は
 * セグメントごとに復号するため、同じファイルへ解決される。
 */
export function collectImageReferences(tree: Root): string[] {
  const references = new Set<string>();
  visit(tree, "element", (node: Element) => {
    const src = imageSource(node);
    if (src !== null) references.add(src);
  });
  return [...references];
}

/**
 * 発行した結果を本文へ反映する。sanitizeより前に呼ぶ。
 *
 * 発行できた画像は `src` をcustom protocolのURLへ書き換える。書き換えなかった `src` は
 * sanitizeが落とすため、ワークスペース外や `data:` の画像が表示されることはない（7.3）。
 *
 * 発行できなかった画像は、その位置に原因を示す要素へ置き換える。本文全体は壊さない（7.3）。
 */
export function applyImageResources(
  tree: Root,
  resources: readonly ImageResource[],
): void {
  const byReference = new Map(
    resources.map((resource) => [resource.reference, resource]),
  );
  visit(tree, "element", (node: Element, index, parent) => {
    const src = imageSource(node);
    if (src === null) return;
    const resource = byReference.get(src);
    if (resource === undefined) return;
    if (resource.status === "issued") {
      node.properties.src = `${IMAGE_RESOURCE_ORIGIN}/${resource.resourceId}`;
      return;
    }
    if (parent === undefined || index === undefined) return;
    parent.children[index] = imageError(resource.error.message);
  });
}

function imageSource(node: Element): string | null {
  if (node.tagName !== "img") return null;
  const src = node.properties.src;
  return typeof src === "string" && src !== "" ? src : null;
}

function imageError(message: string): ElementContent {
  return {
    type: "element",
    tagName: "span",
    properties: { className: [IMAGE_ERROR_CLASS] },
    children: [{ type: "text", value: message }],
  };
}
