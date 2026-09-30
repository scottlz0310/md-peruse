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
 * `index` 以降で、最初の文字の境界を返す。`CLUSTER_SEARCH_CHARS` の範囲に無ければ、その範囲の
 * 端で切る（サロゲートペアの途中だけは避ける）。
 */
function boundaryAtOrAfter(text: string, index: number): number {
  const from = Math.max(0, index - CLUSTER_SEARCH_CHARS);
  let to = Math.min(text.length, index + CLUSTER_SEARCH_CHARS);
  // 範囲の端がサロゲートペアの途中なら、対を含める。範囲の端で切るときに、対を割らないためである
  // （`Intl.Segmenter` が、対の前半だけを別の文字として返す実装に頼らない）。
  if (splitsSurrogatePair(text, to)) to += 1;
  for (const { index: offset } of GRAPHEMES.segment(text.slice(from, to))) {
    if (from + offset >= index) return from + offset;
  }
  return to;
}

/**
 * `start` から始まる文字列の終わりを決める。
 *
 * `chunkChars` 以上、その2倍までの範囲で、改行の直後、なければ空白の直後で切る。どちらもなければ
 * 範囲の上限で切る（1行が極端に長いテキストのため）。空白と上限で切るときは、文字を途中で
 * 切らない境界へ寄せる。探す範囲は `chunkChars` と `CLUSTER_SEARCH_CHARS` に限るため、
 * 走査は本文の長さに比例する。
 */
function chunkEnd(text: string, start: number, chunkChars: number): number {
  const minEnd = start + chunkChars;
  if (minEnd >= text.length) return text.length;
  const maxEnd = Math.min(text.length, start + 2 * chunkChars);

  let afterSpace = -1;
  for (let index = minEnd; index < maxEnd; index++) {
    const code = text.charCodeAt(index);
    if (code === NEWLINE) return index + 1;
    if (code === SPACE && afterSpace === -1) afterSpace = index + 1;
  }

  return boundaryAtOrAfter(text, afterSpace === -1 ? maxEnd : afterSpace);
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
