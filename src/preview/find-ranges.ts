import { FIND_EXCLUDED_SELECTORS, findMatchOffsets } from "../state/find";

/**
 * 一致を1つにまとめない境界とする要素。
 *
 * 段落の末尾と次の段落の先頭をつないで一致させないためである。境界には検索語に現れない
 * 改行を挟む（{@link collectFindRanges}）。
 */
const BLOCK_SELECTOR = [
  "address",
  "article",
  "blockquote",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "td",
  "th",
  "tr",
  "ul",
].join(",");

const EXCLUDED_SELECTOR = FIND_EXCLUDED_SELECTORS.join(",");

type Piece = { node: Text; start: number };

/**
 * `root` の中で `query` に一致する範囲を文書順に返す（design-decisions.md 8.6）。
 *
 * テキストノードを文書順につなぎ、ブロック要素と `br` の境目には改行を挟んでから
 * {@link findMatchOffsets} で探す。検索語は改行を含まない前提であり、境目をまたぐ一致は
 * 生じない。一方でインライン要素（強調、リンク、コードハイライトの `span`）をまたぐ一致は
 * 取れる。件数の上限も {@link findMatchOffsets} に従う。
 */
export function collectFindRanges(root: Element, query: string): Range[] {
  const pieces: Piece[] = [];
  let text = "";
  let previousBlock: Element | null = null;
  let brSincePrevious = false;

  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node instanceof Element && node.matches(EXCLUDED_SELECTOR)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    },
  );
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Element) {
      if (node.localName === "br") brSincePrevious = true;
      continue;
    }
    const data = (node as Text).data;
    if (data.length === 0) continue;
    const block = node.parentElement?.closest(BLOCK_SELECTOR) ?? null;
    if (pieces.length > 0 && (brSincePrevious || block !== previousBlock)) {
      text += "\n";
    }
    pieces.push({ node: node as Text, start: text.length });
    text += data;
    previousBlock = block;
    brSincePrevious = false;
  }

  const offsets = findMatchOffsets(text, query);
  // 一致は文書順に並び重ならないため、テキストノードの添字は戻さずに進める。
  let index = 0;
  function pieceAt(position: number, isEnd: boolean): Piece {
    for (;;) {
      const piece = pieces[index];
      if (piece === undefined) {
        throw new Error(`一致位置 ${position} がテキストの範囲外です`);
      }
      const pieceEnd = piece.start + piece.node.data.length;
      if (isEnd ? position <= pieceEnd : position < pieceEnd) return piece;
      index += 1;
    }
  }

  return offsets.map((offset) => {
    const end = offset + query.length;
    const first = pieceAt(offset, false);
    const last = pieceAt(end, true);
    const range = root.ownerDocument.createRange();
    range.setStart(first.node, offset - first.start);
    range.setEnd(last.node, end - last.start);
    return range;
  });
}
