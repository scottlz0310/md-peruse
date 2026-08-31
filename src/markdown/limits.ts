/**
 * Frontendで行う処理の上限。
 *
 * 値の根拠は design-decisions.md 8.3〜8.5 を正本とする。ここに置くのは、
 * ハイライト・Mermaid・数式のいずれもFrontendが処理を行うためである。画像と
 * Markdownの上限はRust側が検証するため `src-tauri/src/limits.rs` に置く（7.1、7.3）。
 */

const KIB = 1024;

/**
 * コードブロックのハイライト上限。超過したブロックはハイライトせず、プレーンな
 * `pre/code` として表示する。選択とコピーは変わらず行える。
 *
 * lowlightの処理時間は入力サイズにほぼ比例し、49 KiBで28 ms、488 KiBで198 msだった
 * （実測）。時間よりhastノード数が効き、488 KiBは18万ノードを生む。「1 MiBの文書を
 * 500 ms以内に描画する」目標（spec.md 5.1）をハイライトだけで使い切らないよう、
 * ブロック単位と文書単位の二段で抑える。
 */
export const HIGHLIGHT_LIMITS = {
  /** 1ブロックの上限。約1300行、約35 msに相当する。 */
  perBlockBytes: 64 * KIB,
  /** 1文書でハイライトする合計の上限。約100 msに相当する。 */
  perDocumentBytes: 256 * KIB,
} as const;

/**
 * Mermaidの処理上限。
 *
 * `maxEdges` はMermaidの既定値と同じ500だが、既定に依存せず明示する。1000ノードの
 * flowchartは描画に入る前に `Edge limit exceeded` で拒否される（実測）。
 */
export const MERMAID_LIMITS = {
  /** 1図の入力サイズ。 */
  perDiagramBytes: 50 * KIB,
  /** 1図のエッジ数。Mermaidへ渡す `maxEdges`。 */
  maxEdges: 500,
  /** 1図の描画タイムアウト。超過したら中断して理由を表示する。 */
  renderTimeoutMs: 3_000,
  /** 同時に描画する図の数。超過分は順次描画する。 */
  concurrentRenders: 2,
  /** 1文書あたりの図の数。超過分はプレースホルダーを表示する。 */
  perDocumentDiagrams: 50,
} as const;

/**
 * KaTeXへ渡す上限。
 *
 * いずれもKaTeXの既定値に依存せず明示する。`maxExpand` は既定と同じ1000で、
 * `\def\a{\a}\a` の無限再帰と4段のマクロ展開爆発はこの値で停止する（実測）。
 *
 * `maxSize` はユーザーが指定できる寸法の上限（em）であり、出力サイズの上限ではない。
 * `\rule`、`\hspace`、`\kern` の値を制限する。`\raisebox` の `voffset` は対象外で、
 * `\raisebox{500em}{x}` は500emのまま出力される（実測）。この抜けはKaTeX側の制限で
 * あり、本アプリでは塞げない。
 *
 * 数式の個数と単一数式の長さには固有の上限を設けない。5000個で41 ms、5万項の単一
 * 数式で247 msであり（実測）、Markdownの10 MiB上限（7.3、`src-tauri/src/limits.rs`）
 * で律速される。
 */
export const KATEX_LIMITS = {
  /** マクロ展開の回数。 */
  maxExpand: 1_000,
  /** ユーザー指定寸法の上限（em）。 */
  maxSize: 50,
} as const;
