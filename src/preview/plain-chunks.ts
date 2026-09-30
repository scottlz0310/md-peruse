/**
 * 書式なしの本文を分けるときの、1つの文字列の長さの目安。
 *
 * 巨大な1つのテキストノードは、アクセシビリティ木が有効なとき（スクリーンリーダーなど）に、
 * 更新の費用が長さの二乗に近く伸びる（109万文字で5.9秒、543万文字で148秒）。1行が極端に長い
 * テキストは、レイアウトも二乗に伸びる（109万文字の1行で約81秒）。数千文字ごとのノードに分けると、
 * 543万文字でも約2秒で表示できる（design-decisions.md 8.7）。実測で、1,000〜5,000文字は差が無く、
 * 20,000文字からアクセシビリティの費用が増えたため、5,000文字とした。
 */
export const PLAIN_CHUNK_CHARS = 5_000;

/**
 * 切れ目を、文字（書記素）の境界へ寄せるときに、切れ目の前後に見る長さ（UTF-16の単位）。
 *
 * 1つの文字は、結合文字、ゼロ幅接合子、肌色の修飾子、国旗の対、タグ文字の並びなどで、
 * 複数の単位になる。これを途中で切ると、表示や読み上げが変わる。一方、結合文字が
 * 数百万個続くような入力では、境界を探し続けると、1つの文字列が上限を超えて長くなる。
 * 探す範囲をこの長さに抑え、それでも境界がなければ、そのまま切る。1つの文字列の長さは、
 * 必ず `chunkChars` の2倍にこの長さと1を足した値以下になる。
 */
export const CLUSTER_SEARCH_CHARS = 32;

const NEWLINE = 0x0a;
const SPACE = 0x20;
const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;
const LOW_SURROGATE_FIRST = 0xdc00;
const LOW_SURROGATE_LAST = 0xdfff;

/** 文字の境界の判定は、Unicodeの書記素クラスタの規則（`Intl.Segmenter`）に任せる。 */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `index` が、サロゲートペアの途中か。 */
function splitsSurrogatePair(text: string, index: number): boolean {
  const previous = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  return (
    previous >= HIGH_SURROGATE_FIRST &&
    previous <= HIGH_SURROGATE_LAST &&
    next >= LOW_SURROGATE_FIRST &&
    next <= LOW_SURROGATE_LAST
  );
}

/**
 * `index` 以降で、最初の文字の境界を返す。
 *
 * `from` は、文字の境界と分かっている位置（空白、または文字列の先頭）である。判定は、`from` から
 * `index` の後ろ `CLUSTER_SEARCH_CHARS` までを `Intl.Segmenter` へ渡して行う。範囲の先頭が文字の
 * 途中だと、`Intl.Segmenter` は前の文脈を知らず、偽の境界を返す（ZWJ でつながる絵文字の途中、
 * 国旗の対の途中など）。そのため、開始位置は境界と分かっている所に限る。範囲の中に境界が無ければ
 * （結合文字が続く場合）、範囲の端で切る（サロゲートペアの途中だけは避ける）。
 */
function boundaryAtOrAfter(text: string, from: number, index: number): number {
  let to = Math.min(text.length, index + CLUSTER_SEARCH_CHARS);
  // 範囲の端がサロゲートペアの途中なら、対を含める。範囲の端で切るときに、対を割らないためである。
  if (splitsSurrogatePair(text, to)) to += 1;
  const range = text.slice(from, to);
  const containing = GRAPHEMES.segment(range).containing(index - from);
  // 範囲の末尾（本文の末尾）に当たる。
  if (containing === undefined) return to;
  // `index` が、すでに境界である。
  if (containing.index === index - from) return index;
  return from + containing.index + containing.segment.length;
}

/**
 * `start` から始まる文字列の終わりを決める。
 *
 * `chunkChars` 以上、その2倍までの範囲で、改行の直後、なければ空白の直後で切る。どちらもなければ
 * 範囲の上限で切る（1行が極端に長いテキストのため）。空白と上限で切るときは、文字を途中で
 * 切らない境界へ寄せる。改行の直後は、常に文字の境界である。空白の直後は、その空白から、上限で
 * 切るときは、この文字列の先頭から数える（`boundaryAtOrAfter`）。探す範囲は `chunkChars` と
 * `CLUSTER_SEARCH_CHARS` に限るため、走査は本文の長さに比例する。
 */
function chunkEnd(text: string, start: number, chunkChars: number): number {
  const minEnd = start + chunkChars;
  if (minEnd >= text.length) return text.length;
  const maxEnd = Math.min(text.length, start + 2 * chunkChars);

  let space = -1;
  for (let index = minEnd; index < maxEnd; index++) {
    const code = text.charCodeAt(index);
    if (code === NEWLINE) return index + 1;
    if (code === SPACE && space === -1) space = index;
  }

  return space === -1
    ? boundaryAtOrAfter(text, start, maxEnd)
    : boundaryAtOrAfter(text, space, space + 1);
}

/**
 * 書式なしの本文を、React の子要素として並べる複数の文字列に分ける。
 *
 * 分けた文字列は、隣り合うテキストノードになる。表示、選択、コピー、文書内検索は、1つの
 * テキストノードのときと変わらない。つなぎ合わせると元の本文になる。
 */
export function splitPlainText(
  text: string,
  chunkChars: number = PLAIN_CHUNK_CHARS,
): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = chunkEnd(text, start, chunkChars);
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}
