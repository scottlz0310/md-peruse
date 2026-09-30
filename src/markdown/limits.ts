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
 * （実測）。時間よりhastノード数が効き、488 KiBは18万ノードを生む。文書の描画の性能目標
 * （spec.md 5.1）をハイライトだけで使い切らないよう、ブロック単位と文書単位の二段で抑える。
 */
export const HIGHLIGHT_LIMITS = {
  /** 1ブロックの上限。約1300行、約35 msに相当する。 */
  perBlockBytes: 64 * KIB,
  /** 1文書でハイライトする合計の上限。約100 msに相当する。 */
  perDocumentBytes: 256 * KIB,
  /**
   * 1ブロックあたりの最小コスト。
   *
   * 入力サイズだけで数えると、極端に短いブロックが固定コストごと上限を迂回する。
   * 1文字のブロックでも2ノードを生み、20000個で25 msかかる（実測）。この値により
   * ブロック数は8192個までに収まる。
   */
  minBlockCostBytes: 32,
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
 * 入力サイズの上限は、Markdownの10 MiB上限とは別に設ける。KaTeXの出力は入力の約11倍
 * へ膨張し、1 MiBの単一数式は468 ms・出力10.7 MiBとなる（実測）。文書の描画の性能目標
 * （spec.md 5.1）を数式だけで使い切りうるため、Markdownの上限では律速できない。膨張率が高いぶん、閾値はコードブロック（64 KiB / 256 KiB）
 * より厳しくする。
 */
export const KATEX_LIMITS = {
  /** マクロ展開の回数。 */
  maxExpand: 1_000,
  /** ユーザー指定寸法の上限（em）。 */
  maxSize: 50,
  /** 1つの数式の入力サイズ。16 msで出力176 KiBに相当する。 */
  perFormulaBytes: 16 * KIB,
  /** 1文書で描画する数式のコストの合計。約35 msで出力704 KiBに相当する。 */
  perDocumentBytes: 64 * KIB,
  /**
   * 1数式あたりの最小コスト。
   *
   * 入力サイズだけで数えると、短い数式が固定コストごと上限を迂回する。`$x$` は本文が
   * 1バイトでも6要素を生み、5000個で138 msかかる（実測）。本文の合計だけで数えると
   * 65536個が上限内となり、39万要素・数秒に達する。この値により数式は2048個までに
   * 収まり、12000要素・約57 msで頭打ちになる。
   */
  minFormulaCostBytes: 32,
} as const;

/**
 * KaTeXの出力が入力に対して膨らむ倍率の上限。
 *
 * `x+` の繰り返しを1 KiBから977 KiBまで変えても11.0〜11.2倍で一定だった（実測）。
 * 入力サイズの上限から出力サイズを見積もるために使う。上限値を見直すときは、
 * この倍率を掛けた出力サイズがDOMへ流れることを踏まえる。
 */
export const KATEX_OUTPUT_EXPANSION_RATIO = 12;

/**
 * 書式を付けて描画する文書の上限。超えた文書は、パースせずにソースをそのまま表示する
 * （design-decisions.md 8.7）。
 *
 * 描画時間は本文の長さにほぼ比例するが、リストの項目が多いと二乗で伸びる。
 * `mdast-util-from-markdown`（2.0.3）は、リストの項目ごとに、文書全体のイベント配列の途中へ
 * `splice` で2件を挿入する。配列が長いほど1回が高くつくため、時間が「項目数 × 文字数」に
 * 比例して加わる（実測。WebView2、Core i7-12700K）。
 *
 * 単位は文字数（UTF-16コードユニット）である。時間は文字数で決まり、バイト数では決まらない。
 * 日本語主体の文書は1文字が3バイトのため、バイトで数えると同じ時間の文書が3倍の値になる。
 */
export const DOCUMENT_LIMITS = {
  /**
   * 書式を付けて描画する本文の文字数。約60万文字は、日本語主体の文書で約1 MiBに当たり、
   * 描画に約1.4秒かかる（実測）。
   */
  richMaxChars: 600_000,
  /**
   * 「リスト項目数 × 文字数」の上限。この値までの実測で最も遅いのは、ネストしたリスト
   * 21400項目・21万文字の約1.9秒である。超える文書は、単一のリスト1 MiB（2.8万項目、
   * 約4.1秒）、ネストしたリスト500 KiB（4.1万項目、約6.1秒）、同1 MiB（8.2万項目、
   * 約54秒）のように、数秒から数十秒かかる。
   */
  richMaxListItemChars: 5_000_000_000,
  /**
   * 空行で区切られた1つのブロック（段落、表、リスト）の文字数の上限。行の種類は見分けず、
   * フェンスコードの中も数える（{@link hasLongBlock}）。`micromark` は、1つの段落の中の隣り合う `data` イベントの結合（`resolveData`）で、
   * ループの中で `splice` を使うため、記法が密な巨大な段落は二乗で伸びる。強調の入れ子の
   * 連続は、59万文字の1段落で73秒、10万文字で2.3秒、5万文字で0.28秒だった（実測）。10万文字
   * までに抑えると、1つのブロックの最悪が約2.3秒になる。
   */
  richMaxBlockChars: 100_000,
} as const;

/** 書式なしで表示する理由。 */
export type PlainDocumentReason =
  | "tooLong"
  | "tooLongBlock"
  | "tooManyListItems";

/**
 * この文書を書式なしで表示するべきときの理由を返す。書式を付けて描画してよければ `null`。
 *
 * 文字数を先に見る。ブロックの長さとリスト項目の数え上げは、文字数の上限内の文書にだけ
 * 行い、上限を超えた時点で打ち切る。どちらも文字数に比例する1回の走査で、10 MiBのMarkdownでも
 * 一定時間で判定できる。
 *
 * 項目の数え方は {@link countListItems} による。コードブロックの中の行も数えるが、多く
 * 見積もる側であり、書式なしへ倒れるだけで壊れない。
 */
export function plainDocumentReason(text: string): PlainDocumentReason | null {
  const chars = text.length;
  if (chars > DOCUMENT_LIMITS.richMaxChars) return "tooLong";
  if (hasLongBlock(text, DOCUMENT_LIMITS.richMaxBlockChars)) {
    return "tooLongBlock";
  }
  const maxItems = Math.floor(
    DOCUMENT_LIMITS.richMaxListItemChars / Math.max(chars, 1),
  );
  return countListItems(text, maxItems) > maxItems ? "tooManyListItems" : null;
}

const SPACE = 0x20;
const TAB = 0x09;
const QUOTE = 0x3e; // >、引用の接頭辞

/**
 * 空行で区切られたブロックのうち、`limit` 文字を超えるものがあるかを返す。
 *
 * ブロックは、空行（空白とタブだけの行を含む）で区切られた、連続する行である。行の種類は
 * 見分けない。フェンスコードの中も数える。フェンスコードの中は記法の解析にかからないが、
 * ある行がフェンスかどうかは、パーサーの状態（front matter、数式ブロック、HTMLブロック、
 * 引用やリストの中）に依存し、この判定では再現しきれない。フェンスを取り違えて数え落とすと、
 * 長い段落が上限を回避する（レビューで、開始の行と閉じる行について続けて指摘された）。
 * 数えすぎる側は、空行のない10万文字を超えるコードブロックを含む文書が、書式なしになる
 * だけで壊れない。
 *
 * 文字列を1回走査し、文字数に比例する。`limit` を超えた時点で打ち切る。
 */
function hasLongBlock(text: string, limit: number): boolean {
  const length = text.length;
  let lineStart = 0;
  // 現在のブロックの開始位置。空行では -1。
  let blockStart = -1;
  while (lineStart < length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? length : newline;
    if (isBlank(text, lineStart, lineEnd)) {
      blockStart = -1;
    } else {
      if (blockStart === -1) blockStart = lineStart;
      if (lineEnd - blockStart > limit) return true;
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return false;
}

/** 行が、空白とタブだけ（または空）かを返す。 */
function isBlank(text: string, lineStart: number, lineEnd: number): boolean {
  for (let index = lineStart; index < lineEnd; index += 1) {
    const code = text.charCodeAt(index);
    if (code !== SPACE && code !== TAB) return false;
  }
  return true;
}

/**
 * リストの項目を数える。数え上げが `limit` を超えた時点で打ち切り、そのときの値を返す。
 *
 * 各行で、行頭の接頭辞（空白、タブ、引用の `>`）を読み飛ばし、続くマーカー（`-`、`*`、`+`、
 * `1.`、`1)`。番号は9桁まで）を1つずつ数える。引用の中のリスト（`> - a`）と、同じ行に連なる
 * マーカー（`- - a`、`> 1. - a`）は、パーサーも項目として処理するため数える。
 *
 * 正規表現ではなく、文字列を1回走査する。接頭辞を後読みで確かめる正規表現は、マーカーが
 * 連なる長い行で、候補ごとに行頭まで戻り二乗になる。判定そのものが固まらないよう、走査は
 * 文字数に比例する。
 */
function countListItems(text: string, limit: number): number {
  const length = text.length;
  let items = 0;
  let lineStart = 0;
  while (lineStart < length) {
    let position = lineStart;
    for (;;) {
      const code = text.charCodeAt(position);
      if (code !== SPACE && code !== TAB && code !== QUOTE) break;
      position += 1;
    }
    for (;;) {
      const width = listMarkerWidth(text, position);
      if (width === 0) break;
      items += 1;
      if (items > limit) return items;
      position += width;
    }
    const newline = text.indexOf("\n", position);
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return items;
}

/**
 * `position` にあるリストのマーカーと、続く空白（空白とタブの連なり）の長さを返す。
 * マーカーでなければ0。行末までしか読まない。
 */
function listMarkerWidth(text: string, position: number): number {
  const code = text.charCodeAt(position);
  let end = position;
  if (code === 0x2d || code === 0x2a || code === 0x2b) {
    // - * +
    end += 1;
  } else if (code >= 0x30 && code <= 0x39) {
    // 番号は9桁まで。10桁以上はリストの番号ではない。
    while (
      end - position < 9 &&
      text.charCodeAt(end) >= 0x30 &&
      text.charCodeAt(end) <= 0x39
    ) {
      end += 1;
    }
    const delimiter = text.charCodeAt(end);
    // . )
    if (delimiter !== 0x2e && delimiter !== 0x29) return 0;
    end += 1;
  } else {
    return 0;
  }
  const gap = text.charCodeAt(end);
  if (gap !== SPACE && gap !== TAB) return 0;
  while (text.charCodeAt(end) === SPACE || text.charCodeAt(end) === TAB) {
    end += 1;
  }
  return end - position;
}

/**
 * このコードブロックが文書の予算から消費する量を返す。
 *
 * 呼び出し側はこの値を積み上げ、`shouldHighlight` の `spentBudget` へ渡す。
 * 入力サイズをそのまま積むと、短いブロックの固定コストが数えられない。
 */
export function highlightCost(blockBytes: number): number {
  return Math.max(blockBytes, HIGHLIGHT_LIMITS.minBlockCostBytes);
}

/**
 * この数式が文書の予算から消費する量を返す。
 *
 * 呼び出し側はこの値を積み上げ、`shouldRenderMath` の `spentBudget` へ渡す。
 */
export function mathRenderCost(formulaBytes: number): number {
  return Math.max(formulaBytes, KATEX_LIMITS.minFormulaCostBytes);
}

/**
 * このコードブロックをハイライトしてよいかを返す。
 *
 * 超過したブロックはハイライトせず、プレーンな `pre/code` として表示する
 * （design-decisions.md 8.3）。`spentBudget` には、その文書で既にハイライトした
 * ブロックの `highlightCost` の合計を渡す。
 */
export function shouldHighlight(
  blockBytes: number,
  spentBudget: number,
): boolean {
  return (
    blockBytes <= HIGHLIGHT_LIMITS.perBlockBytes &&
    spentBudget + highlightCost(blockBytes) <= HIGHLIGHT_LIMITS.perDocumentBytes
  );
}

/**
 * この数式を描画してよいかを返す。
 *
 * 超過した数式は描画せず、ソースをそのまま表示する（design-decisions.md 8.5）。
 * `spentBudget` には、その文書で既に描画した数式の `mathRenderCost` の合計を渡す。
 */
export function shouldRenderMath(
  formulaBytes: number,
  spentBudget: number,
): boolean {
  return (
    formulaBytes <= KATEX_LIMITS.perFormulaBytes &&
    spentBudget + mathRenderCost(formulaBytes) <= KATEX_LIMITS.perDocumentBytes
  );
}
