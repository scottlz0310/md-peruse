/**
 * 文書内検索の一致規則と上限（design-decisions.md 8.6）。
 *
 * WebView2標準の検索バーは使わず、`Ctrl+F` の `keydown` を `preventDefault` で奪って
 * 自前のUIを開く。標準の検索バーはWebView全体のDOMを対象とするため、サイドバーの
 * ファイル名やタブ名がヒットする（実測）。プレビュー本文だけを対象にするには自前で
 * 走査するほかない。
 *
 * ハイライトはCSS Custom Highlight APIで行い、DOMは書き換えない。sanitize後の木と
 * 見出しアンカーのIDを壊さないためである。
 */

/**
 * 1文書で保持する一致の上限。
 *
 * 超過した分は探索を打ち切り、上限に達したことをUIへ示す。`Highlight` へ登録する
 * `Range` は一致1件につき1つ生成されるため、上限がないと巨大な文書で数万件のRangeを
 * 抱えることになる。10 MiBのMarkdown（8.3）で1文字を検索する場合が最悪であり、
 * そこまで多い一致を順に見て回る操作には意味がない。
 */
export const MAX_FIND_MATCHES = 1000;

/** すべての一致へ割り当てるハイライトの名前（`::highlight()` の引数）。 */
export const FIND_HIGHLIGHT_NAME = "md-peruse-find";

/** 現在位置の一致だけへ割り当てるハイライトの名前。 */
export const FIND_ACTIVE_HIGHLIGHT_NAME = "md-peruse-find-active";

/**
 * 検索対象から除外する要素のセレクタ（design-decisions.md 8.6）。
 *
 * KaTeXの出力はMathMLのテキストと `annotation` 要素のLaTeXソースを同時に持つため、
 * 走査すると同じ数式が二重にヒットする（7.2で実測済みの構造）。Mermaidが生成するSVGは
 * `text` 要素の配置が図形のレイアウトに従うため、`::highlight()` を掛けたときの見え方を
 * 保証できない。どちらも対象から外す。
 *
 * コードブロックは対象に含める。lowlightが入れるのは `span` の入れ子だけであり、
 * テキストノードを文書順につなげば素直に一致を取れる。
 */
export const FIND_EXCLUDED_SELECTORS = [".katex", "svg"] as const;

/**
 * 一致判定のために文字列を畳む。大文字小文字だけを吸収する。
 *
 * コードポイントごとに小文字化し、UTF-16コードユニット数が変わる文字は元のまま残す。
 * 文字列全体へ `toLowerCase()` を掛けると長さが変わりうるためである。`"İ"` は1コード
 * ユニットだが小文字化すると `"i̇"` の2コードユニットになる（実測）。`Range` の
 * オフセットはコードユニットで数えるため、長さが変わると一致位置をDOMへ戻せない。
 *
 * 全角と半角、濁点の合成は吸収しない。互換正規化はコードユニット数を変えるため、
 * 正規化後の位置を元のオフセットへ戻す写像を別に持つことになり、ハイライト位置がずれる
 * 不具合を招きやすい。
 *
 * この規則の下では、語末シグマ `ς` は `Σ` と一致しない。`Σ` の小文字化は `σ` であり、
 * `ς` の小文字化は `ς` のままだからである（実測）。長さを保つことを優先した結果として残る。
 */
export function foldForFind(text: string): string {
  let folded = "";
  for (const char of text) {
    const lower = char.toLowerCase();
    folded += lower.length === char.length ? lower : char;
  }
  return folded;
}

/**
 * 畳んだ文字列の中から一致の開始位置を列挙する。
 *
 * 重なる一致は数えない。`"aaa"` から `"aa"` を探すと位置0だけを返す。次の探索は一致の
 * 直後から始める。ブラウザの検索と同じ数え方であり、重なりを含めると `"aaaa"` のような
 * 入力で件数が語長に比例して増える。
 *
 * `needle` が空のときは何も返さない。呼び出し側は入力が空の間ハイライトを消す。
 *
 * 返す件数は {@link MAX_FIND_MATCHES} で打ち切る。打ち切ったかどうかは呼び出し側が
 * 件数と上限を比べて判定する。
 */
export function findMatchOffsets(haystack: string, needle: string): number[] {
  if (needle.length === 0) {
    return [];
  }
  const foldedHaystack = foldForFind(haystack);
  const foldedNeedle = foldForFind(needle);
  const offsets: number[] = [];
  let from = 0;
  while (offsets.length < MAX_FIND_MATCHES) {
    const found = foldedHaystack.indexOf(foldedNeedle, from);
    if (found === -1) {
      break;
    }
    offsets.push(found);
    from = found + foldedNeedle.length;
  }
  return offsets;
}

/** 次の一致へ進むか、前の一致へ戻るか。 */
export type FindDirection = "next" | "previous";

/**
 * 現在位置から次（または前）の一致の添字を返す。端では反対側へ折り返す。
 *
 * `current` が `-1` のとき（まだどの一致も選んでいないとき）は、`next` で先頭、
 * `previous` で末尾を選ぶ。一致が1件もなければ `-1` を返す。
 */
export function stepMatchIndex(
  matchCount: number,
  current: number,
  direction: FindDirection,
): number {
  if (matchCount <= 0) {
    return -1;
  }
  if (current < 0) {
    return direction === "next" ? 0 : matchCount - 1;
  }
  const offset = direction === "next" ? 1 : -1;
  return (current + offset + matchCount) % matchCount;
}
