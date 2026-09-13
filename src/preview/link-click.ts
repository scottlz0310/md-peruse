import { footnoteElementId } from "../markdown/heading-id";
import {
  type LinkRejectionReason,
  type LinkTarget,
  resolveLinkTarget,
} from "../markdown/link-target";

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

/**
 * リンクを解決できなかった理由の表示文言。
 *
 * UI文字列の分離（dev-flow 6.3）までは日本語だけを持つ。`Record` にしているのは、理由を
 * 増やしたときに文言の漏れを `tsc --noEmit` で検出するためである。
 */
export const LINK_REJECTION_MESSAGES: Record<LinkRejectionReason, string> = {
  emptyTarget: "リンク先が指定されていません。",
  malformedEncoding: "リンク先の表記を解釈できません。",
  invalidFileName: "リンク先のファイル名に使えない文字が含まれています。",
  schemeRelative: "この形式のリンクは開けません。",
  outsideRoot: "開いているフォルダーの外は表示できません。",
  notMarkdown: "Markdown以外のファイルへのリンクは開けません。",
};
