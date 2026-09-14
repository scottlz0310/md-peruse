import {
  type MouseEvent,
  type ReactElement,
  type Ref,
  type RefObject,
  useEffect,
  useState,
} from "react";
import type { LinkTarget } from "../markdown/link-target";
import { renderMarkdown } from "../markdown/render";
import type { ViewTarget } from "../state/document-tab";
import type { ImageResource } from "../types/generated/ImageResource";
import { targetOfLink } from "./link-click";

type Props = {
  /** 読み込んだ本文。改行はRust側でLFへ正規化済み（6.3）。 */
  text: string;
  /** 文書のルート相対パス。本文中の相対リンクの基点になる（7.2）。 */
  path: string;
  /**
   * 描画の完了後に移す位置。見出しへのリンク（7.2）や戻る／進む（9.3）で表示が変わるたびに
   * 新しいオブジェクトを渡す。同じオブジェクトのままなら移し直さない。
   */
  view: ViewTarget;
  /**
   * 本文中のリンクを押したときに呼ぶ。同一文書内のアンカーも履歴へ積むため（9.3）、
   * 移動は呼び出し側が `view` で指示する。
   */
  onNavigate: (target: LinkTarget) => void;
  /**
   * 文書が参照する画像へresource IDを発行する（5.4）。製品では `issueImageResources` を渡す。
   * 参照が変わらない関数を渡すこと。変わるたびに描画し直す。
   */
  issueImages: (
    documentPath: string,
    references: string[],
  ) => Promise<ImageResource[]>;
  /** 本文をスクロールさせる要素。戻る／進むで離れたときの位置へ戻す（9.3）。 */
  scroller: RefObject<HTMLElement | null>;
  /** 本文の要素。文書内検索（8.6）の対象として渡す。 */
  ref?: Ref<HTMLElement>;
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
  view,
  onNavigate,
  issueImages,
  scroller,
  ref,
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
    if (rendered !== text) return;
    if (view.anchor === null) {
      if (scroller.current) scroller.current.scrollTop = view.scrollTop;
    } else {
      document.getElementById(view.anchor)?.scrollIntoView();
    }
  }, [view, rendered, text, scroller]);

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
    if (target !== null) onNavigate(target);
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: リンクへの操作を委譲で受けるだけで、要素自体は操作対象ではない。キーボードでリンクを開くとclickが発火するため、キー操作もこのハンドラを通る。
    <article
      ref={ref}
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
