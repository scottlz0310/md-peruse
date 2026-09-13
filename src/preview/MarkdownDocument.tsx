import { type MouseEvent, type ReactElement, useEffect, useState } from "react";
import type { LinkTarget } from "../markdown/link-target";
import { renderMarkdown } from "../markdown/render";
import type { ImageResource } from "../types/generated/ImageResource";
import { targetOfLink } from "./link-click";

/** 描画する要素の外で扱う遷移先。同一文書内のアンカーはこの要素の中で完結する。 */
export type NavigationTarget = Exclude<LinkTarget, { kind: "anchor" }>;

type Props = {
  /** 読み込んだ本文。改行はRust側でLFへ正規化済み（6.3）。 */
  text: string;
  /** 文書のルート相対パス。本文中の相対リンクの基点になる（7.2）。 */
  path: string;
  /**
   * 描画の完了後に移動する要素のID。`./other.md#section` のように、別の文書の見出しを
   * 指すリンクで開いた場合に渡す（7.2）。
   */
  anchor: string | null;
  /** 別の文書、外部URL、解決できなかったリンクを押したときに呼ぶ。 */
  onNavigate: (target: NavigationTarget) => void;
  /**
   * 文書が参照する画像へresource IDを発行する（5.4）。製品では `issueImageResources` を渡す。
   * 参照が変わらない関数を渡すこと。変わるたびに描画し直す。
   */
  issueImages: (
    documentPath: string,
    references: string[],
  ) => Promise<ImageResource[]>;
};

/**
 * Markdownの本文を描画する。
 *
 * 描画は非同期であり、本文が差し替わった後に前の描画が完了することがある。effectの
 * 片付けで前の描画の結果を捨て、古い本文で新しい本文を上書きしない。
 */
export function MarkdownDocument({
  text,
  path,
  anchor,
  onNavigate,
  issueImages,
}: Props) {
  const [content, setContent] = useState<ReactElement | null>(null);
  const [rendered, setRendered] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    renderMarkdown(text, (references) => issueImages(path, references)).then(
      (element) => {
        if (!current) return;
        setContent(element);
        setRendered(text);
      },
    );
    return () => {
      current = false;
    };
  }, [text, path, issueImages]);

  // 描画が現在の本文に追いついてから移動する。追いつく前に探すと、前の文書の同名の
  // 見出しへ移動しうる。
  useEffect(() => {
    if (anchor !== null && rendered === text) scrollToElement(anchor);
  }, [anchor, rendered, text]);

  function handleClick(event: MouseEvent<HTMLElement>) {
    const link = linkOf(event);
    if (link === null) return;
    // WebViewを遷移させない。相対リンクではWebView全体が別のURLへ移り、同一文書内の
    // アンカーもHistory APIへ履歴を積む（9.3）。
    event.preventDefault();
    // `Ctrl` + クリックと `Shift` + クリックは、既定では新しいウィンドウを開く操作である。
    // 同じタブで開く動作に読み替えず、何もしない。
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.shiftKey ||
      event.metaKey
    ) {
      return;
    }
    const target = targetOfLink(link, path);
    if (target === null) return;
    if (target.kind === "anchor") {
      scrollToElement(target.elementId);
      return;
    }
    onNavigate(target);
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: リンクへの操作を委譲で受けるだけで、要素自体は操作対象ではない。キーボードでリンクを開くとclickが発火するため、キー操作もこのハンドラを通る。
    <article
      className="markdown-body"
      onClick={handleClick}
      // 中クリックは新しいウィンドウを開く。遷移させずに捨てる。
      onAuxClick={(event) => {
        if (linkOf(event) !== null) event.preventDefault();
      }}
    >
      {content}
    </article>
  );
}

function linkOf(event: MouseEvent<HTMLElement>): Element | null {
  return event.target instanceof Element ? event.target.closest("a") : null;
}

/** IDの要素へ移動する。見つからなければ何もしない（見出しの無いアンカー）。 */
function scrollToElement(elementId: string) {
  document.getElementById(elementId)?.scrollIntoView();
}
