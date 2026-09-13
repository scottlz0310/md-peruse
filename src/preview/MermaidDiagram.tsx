import { useEffect, useState, useSyncExternalStore } from "react";
import { MERMAID_LIMITS } from "../markdown/limits";
import {
  MermaidRenderError,
  type MermaidTheme,
  renderMermaid,
} from "../markdown/mermaid";

/** 図を描画できなかったことをブロックの直後に示す要素のクラス。 */
export const MERMAID_ERROR_CLASS = "mermaid-error";

/** 描画した図を包む要素のクラス。 */
export const MERMAID_DIAGRAM_CLASS = "mermaid-diagram";

type Props = {
  /** 図の定義。 */
  source: string;
  /** 文書内で何番目の図か。 */
  index: number;
  /** 製品では `renderMermaid`。テストで描画を差し替えるために受け取る。 */
  render?: (source: string, theme: MermaidTheme) => Promise<string>;
};

type State =
  | { status: "pending" }
  | { status: "done"; svg: string }
  | { status: "failed"; reason: string };

const DARK = "(prefers-color-scheme: dark)";
const FORCED_COLORS = "(forced-colors: active)";

function subscribeTheme(onChange: () => void): () => void {
  const queries = [DARK, FORCED_COLORS].map((query) => matchMedia(query));
  for (const query of queries) query.addEventListener("change", onChange);
  return () => {
    for (const query of queries) query.removeEventListener("change", onChange);
  };
}

/**
 * 表示中のテーマに合うMermaidのテーマ（8.4）。
 *
 * `forced-colors` が有効なときは、色ではなく形状と境界線で区別できる `neutral` にする。
 */
function currentTheme(): MermaidTheme {
  if (matchMedia(FORCED_COLORS).matches) return "neutral";
  return matchMedia(DARK).matches ? "dark" : "default";
}

/**
 * Mermaidの図（design-decisions.md 8.4）。
 *
 * 描画を待つ間は定義をコードブロックとして表示する。描画できなかった図と、1文書の上限を
 * 超えた図は、定義を残したままブロックの直後に理由を示す（12章）。テーマが変わったら
 * 描画し直す。
 */
export function MermaidDiagram({
  source,
  index,
  render = renderMermaid,
}: Props) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  const overLimit = index >= MERMAID_LIMITS.perDocumentDiagrams;
  const [state, setState] = useState<State>({ status: "pending" });

  useEffect(() => {
    if (overLimit) return;
    let current = true;
    setState({ status: "pending" });
    render(source, theme).then(
      (svg) => {
        if (current) setState({ status: "done", svg });
      },
      (error: unknown) => {
        if (!current) return;
        setState({
          status: "failed",
          reason:
            error instanceof MermaidRenderError
              ? error.message
              : `図を描画できません（${String(error)}）。`,
        });
      },
    );
    return () => {
      current = false;
    };
  }, [source, theme, overLimit, render]);

  if (!overLimit && state.status === "done") {
    return (
      <div
        className={MERMAID_DIAGRAM_CLASS}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: 本文描画で唯一の例外（8.4）。Mermaidが生成したSVGを `sanitizeMermaidSvg`（DOMPurify）で処理した文字列だけを渡す。
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }
  const reason = overLimit
    ? "1つの文書に図が多すぎるため描画していません。"
    : state.status === "failed"
      ? state.reason
      : null;
  return (
    <>
      <pre>
        <code className="language-mermaid">{source}</code>
      </pre>
      {reason !== null && <p className={MERMAID_ERROR_CLASS}>{reason}</p>}
    </>
  );
}
