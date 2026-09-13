import { type MouseEvent, type ReactElement, useEffect, useState } from "react";
import { renderMarkdown } from "../markdown/render";

type Props = {
  /** 読み込んだ本文。改行はRust側でLFへ正規化済み（6.3）。 */
  text: string;
};

/**
 * Markdownの本文を描画する。
 *
 * 描画は非同期であり、本文が差し替わった後に前の描画が完了することがある。effectの
 * 片付けで前の描画の結果を捨て、古い本文で新しい本文を上書きしない。
 */
export function MarkdownDocument({ text }: Props) {
  const [content, setContent] = useState<ReactElement | null>(null);

  useEffect(() => {
    let current = true;
    renderMarkdown(text).then((element) => {
      if (current) setContent(element);
    });
    return () => {
      current = false;
    };
  }, [text]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: リンクへの操作を委譲で止めるだけで、要素自体は操作対象ではない。キーボードでリンクを開くとclickが発火するため、キー操作もこのハンドラで止まる。
    <article
      className="markdown-body"
      onClick={blockLinkNavigation}
      onAuxClick={blockLinkNavigation}
    >
      {content}
    </article>
  );
}

/**
 * 本文中のリンクでWebViewを遷移させない。
 *
 * 遷移を許すと、相対リンクではWebView全体が別のURLへ移り、アプリの画面が失われる。
 * 中クリックと `Ctrl` + クリックは新しいウィンドウを開く。同一文書内のアンカーも
 * History APIへ履歴を積むため止める（9.3）。リンクの解決と遷移（7.2）は後続の単位で
 * ここへ加える。
 */
function blockLinkNavigation(event: MouseEvent<HTMLElement>) {
  if (event.target instanceof Element && event.target.closest("a")) {
    event.preventDefault();
  }
}
