import { footnoteElementId } from "../markdown/heading-id";
import { type LinkTarget, resolveLinkTarget } from "../markdown/link-target";

/**
 * 本文中でクリックされたリンクの遷移先を求める（design-decisions.md 7.2）。
 *
 * `href` を持たないリンクには `null` を返す。sanitizeが危険なスキーム（`javascript:` など）の
 * `href` を落としたリンクがこれに当たり、クリックしても何もしない。
 *
 * 脚注の相互参照リンクは、IDが前置済みで `href` と対応しているため、`data-footnote-ref` と
 * `data-footnote-backref` 属性で経路を分けて前置しない。
 */
export function targetOfLink(
  link: Element,
  documentPath: string,
): LinkTarget | null {
  const href = link.getAttribute("href");
  if (href === null) return null;
  if (
    link.hasAttribute("data-footnote-ref") ||
    link.hasAttribute("data-footnote-backref")
  ) {
    const elementId = href.startsWith("#")
      ? footnoteElementId(href.slice(1))
      : null;
    return elementId === null
      ? { kind: "rejected", reason: "malformedEncoding" }
      : { kind: "anchor", elementId };
  }
  return resolveLinkTarget(href, { documentPath });
}
