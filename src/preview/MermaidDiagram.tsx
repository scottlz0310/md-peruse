import { useEffect, useState, useSyncExternalStore } from "react";
import { useMessages } from "../i18n/LanguageContext";
import type { Messages } from "../i18n/messages";
import { MERMAID_LIMITS } from "../markdown/limits";
import {
  type MermaidFailure,
  MermaidRenderError,
  type MermaidTheme,
  renderMermaid,
} from "../markdown/mermaid";
import { PENDING_ATTRIBUTE } from "../print/print-document";
import { usePrinting } from "../print/print-state";

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

/** 再描画の間も表示し続ける、描画済みの図。定義が変わった図には使わない。 */
type Shown = { svg: string; source: string };

type State =
  | { status: "pending"; previous: Shown | null }
  | { status: "done"; svg: string; theme: MermaidTheme; source: string }
  | { status: "failed"; failure: MermaidFailure };

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

/** 失敗の種類から、現在のUI言語の文言を組み立てる。言語を切り替えても、描画し直さずに変わる。 */
function failureMessage(
  messages: Messages["mermaid"],
  failure: MermaidFailure,
): string {
  switch (failure.kind) {
    case "tooLarge":
      return messages.tooLarge;
    case "timeout":
      return messages.timeout;
    case "loadFailed":
      return messages.loadFailed(failure.detail);
    case "renderFailed":
      return messages.renderFailed(failure.detail);
  }
}

/** 描画済みの図。描画中の印は、印刷の待ち合わせが見る（10.7）。 */
function Diagram({ svg, pending = false }: { svg: string; pending?: boolean }) {
  return (
    <div
      className={MERMAID_DIAGRAM_CLASS}
      {...(pending ? { [PENDING_ATTRIBUTE]: "" } : {})}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: 本文描画で唯一の例外（8.4）。Mermaidが生成したSVGを `sanitizeMermaidSvg`（DOMPurify）で処理した文字列だけを渡す。
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
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
  const messages = useMessages().mermaid;
  const screenTheme = useSyncExternalStore(subscribeTheme, currentTheme);
  // 印刷は白地に合う配色にそろえる。画面のテーマには依存させない（10.7）。
  const theme: MermaidTheme = usePrinting() ? "default" : screenTheme;
  const overLimit = index >= MERMAID_LIMITS.perDocumentDiagrams;
  const [state, setState] = useState<State>({
    status: "pending",
    previous: null,
  });
  // テーマが変わった直後は、描画済みの図が古い配色のままである。effectが `pending` にする
  // のを待つと、その前に印刷の待ち合わせが「描画済み」と判断して印刷を始めてしまう。
  // 描画と同じコミットで描画中として扱い、印を付ける（10.7）。
  const stale = state.status === "done" && state.theme !== theme;

  useEffect(() => {
    if (overLimit) return;
    let current = true;
    // 再描画の間も、描画済みの図を残す。定義のコードブロックへ戻すと、その間に取られる
    // 印刷の文書（右クリックの印刷は、開始の前後でテーマが一時的に切り替わる）が、図ではなく
    // 定義で出る（10.7）。定義が変わった図は、古い図を残さない。
    setState((current) => ({
      status: "pending",
      previous:
        current.status === "done"
          ? { svg: current.svg, source: current.source }
          : current.status === "pending"
            ? current.previous
            : null,
    }));
    render(source, theme).then(
      (svg) => {
        if (current) setState({ status: "done", svg, theme, source });
      },
      (error: unknown) => {
        if (!current) return;
        setState({
          status: "failed",
          failure:
            error instanceof MermaidRenderError
              ? error.failure
              : { kind: "renderFailed", detail: String(error) },
        });
      },
    );
    return () => {
      current = false;
    };
  }, [source, theme, overLimit, render]);

  if (!overLimit && state.status === "done" && !stale) {
    return <Diagram svg={state.svg} />;
  }
  // 再描画の間は、描画済みの図を残し、描画中の印を付ける。
  const shown =
    state.status === "done"
      ? { svg: state.svg, source: state.source }
      : state.status === "pending"
        ? state.previous
        : null;
  if (!overLimit && shown !== null && shown.source === source) {
    return <Diagram svg={shown.svg} pending />;
  }
  const reason = overLimit
    ? messages.tooManyInDocument
    : state.status === "failed"
      ? failureMessage(messages, state.failure)
      : null;
  return (
    <>
      <pre
        {...(!overLimit && (state.status === "pending" || stale)
          ? { [PENDING_ATTRIBUTE]: "" }
          : {})}
      >
        <code className="language-mermaid">{source}</code>
      </pre>
      {reason !== null && <p className={MERMAID_ERROR_CLASS}>{reason}</p>}
    </>
  );
}
