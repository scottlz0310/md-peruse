/**
 * 同時に開けるタブ数の上限（design-decisions.md 9.1）。
 *
 * 非アクティブタブが保持するのはパス、タイトル、スクロール位置、状態、読込世代だけであり、
 * 本文DOMは持たない。上限はメモリではなくタブバーの可読性で決めた。これを超えるタブ数は、
 * 一覧から選ぶより開き直すほうが速い。
 */
export const MAX_OPEN_TABS = 20;

/** 上限を超えたときに閉じる候補を選ぶために必要な情報。 */
export type EvictionCandidate = {
  readonly tabId: string;
  /**
   * 最後にアクティブになった時刻（ミリ秒）。タブを開いた時点でも設定する。
   *
   * タブの並び順ではなく最終アクティブ時刻で選ぶのは、並べ替えても「最近見たもの」が
   * 残るようにするためである。
   */
  readonly lastActivatedAt: number;
};

/**
 * 上限を超えるときに閉じるタブを選ぶ。
 *
 * 最後にアクティブだった時刻が最も古い非アクティブタブを返す。候補がなければ `undefined`
 * を返す（アクティブタブだけが開いている場合）。
 *
 * `deleted` 状態のタブ（design-decisions.md 6.5）も候補に含める。上限は20と十分に大きく、
 * 削除済みタブがそこまで溜まるのは異常な状態であり、そのために退避規則を2本に分けると
 * 「候補がないときは新規オープンを拒否する」という別の振る舞いを起動経路ごとに抱えることに
 * なるためである。本アプリはRead-onlyであり、閉じても失われるのはスクロール位置と、
 * 削除済みタブでは最後に読めた内容の表示だけである。
 *
 * 時刻が同じ候補が複数ある場合は、渡された順で先にあるものを選ぶ。
 */
export function selectEvictableTab<T extends EvictionCandidate>(
  tabs: readonly T[],
  activeTabId: string,
): T | undefined {
  let oldest: T | undefined;
  for (const tab of tabs) {
    if (tab.tabId === activeTabId) {
      continue;
    }
    if (oldest === undefined || tab.lastActivatedAt < oldest.lastActivatedAt) {
      oldest = tab;
    }
  }
  return oldest;
}
