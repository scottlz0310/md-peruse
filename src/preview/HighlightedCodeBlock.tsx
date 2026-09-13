import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { type ReactNode, useEffect, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { highlightCode } from "../markdown/highlight";

/** ハイライトの失敗をブロックの直後に示す要素のクラス。 */
export const HIGHLIGHT_ERROR_CLASS = "highlight-error";

type Props = {
  /** allowlistで解決した文法名。 */
  language: string;
  /** コードブロックの本文。 */
  code: string;
  /** sanitize済みの `language-*` クラス。そのまま `code` 要素へ付ける。 */
  className: string;
  /** 製品では `highlightCode`。テストで読込の失敗を注入するために受け取る。 */
  highlight?: typeof highlightCode;
};

type State =
  | { status: "pending" }
  | { status: "done"; content: ReactNode }
  | { status: "failed" };

/**
 * ハイライトするコードブロック（design-decisions.md 8.3）。
 *
 * 文法の読込を待つ間はプレーンなテキストを表示する。選択とコピーはどちらの状態でも行える。
 * 文法の読込やハイライトに失敗した場合もプレーンなまま残し、ブロックの直後に原因を示す
 * （12章）。本文全体は壊さない。
 */
export function HighlightedCodeBlock({
  language,
  code,
  className,
  highlight = highlightCode,
}: Props) {
  const [state, setState] = useState<State>({ status: "pending" });

  useEffect(() => {
    let current = true;
    setState({ status: "pending" });
    highlight(language, code).then(
      (tree) => {
        if (!current) return;
        setState({
          status: "done",
          content: toJsxRuntime(tree, { Fragment, jsx, jsxs }),
        });
      },
      () => {
        if (current) setState({ status: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [language, code, highlight]);

  return (
    <>
      <pre>
        <code className={className}>
          {state.status === "done" ? state.content : code}
        </code>
      </pre>
      {state.status === "failed" && (
        <p className={HIGHLIGHT_ERROR_CLASS}>
          {`${language} のハイライトを読み込めませんでした。プレーンなテキストで表示しています。`}
        </p>
      )}
    </>
  );
}
