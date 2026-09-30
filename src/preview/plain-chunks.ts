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

const NEWLINE = 0x0a;
const SPACE = 0x20;
const ZERO_WIDTH_JOINER = 0x200d;
const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;

/** 直前の文字と切り離すと表示が変わる文字（結合文字、ゼロ幅接合子、異体字セレクタ）。 */
const CLUSTER_CONTINUATION = /^(?:\p{M}|‍|️)/u;

/**
 * `index` の位置で切ると、文字（サロゲートペア）や、結合文字・ゼロ幅接合子でつながる文字の
 * 並びを、途中で切ってしまうか。
 */
function splitsCluster(text: string, index: number): boolean {
  const previous = text.charCodeAt(index - 1);
  if (
    previous === ZERO_WIDTH_JOINER ||
    (previous >= HIGH_SURROGATE_FIRST && previous <= HIGH_SURROGATE_LAST)
  ) {
    return true;
  }
  const next = text.codePointAt(index);
  return (
    next !== undefined && CLUSTER_CONTINUATION.test(String.fromCodePoint(next))
  );
}

/**
 * `start` から始まる文字列の終わりを決める。
 *
 * `chunkChars` 以上、その2倍までの範囲で、改行の直後、なければ空白の直後で切る。どちらも
 * なければ範囲の上限で切る（1行が極端に長いテキストのため）。上限で切るときは、文字を
 * 途中で切らない位置へ進める。範囲は `chunkChars` に限るため、走査は本文の長さに比例する。
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

  let end = afterSpace === -1 ? maxEnd : afterSpace;
  while (end < text.length && splitsCluster(text, end)) end += 1;
  return end;
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
