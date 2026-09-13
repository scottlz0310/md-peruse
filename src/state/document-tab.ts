import {
  pushHistoryEntry,
  removeHistoryEntryAt,
  type TabHistory,
  updateCurrentScroll,
} from "./doc-history";
import {
  applyLoadResult,
  beginLoad,
  isCurrentLoad,
  type LoadToken,
  type TrackedTab,
} from "./tab-status";

/**
 * 文書を表示するタブ（design-decisions.md 9.1、9.3）。
 *
 * タブバーを持つまでは画面に1つだけ置く。読込の世代（6.5）と戻る／進むの履歴（9.3）を
 * タブが持つことで、複数タブへ広げるときに状態を移し替えずに済む。
 */
export type DocumentTab = TrackedTab & { readonly history: TabHistory };

/** 表示が変わったあとに移す位置。`anchor` があればそちらを優先する。 */
export type ViewTarget = {
  readonly anchor: string | null;
  readonly scrollTop: number;
};

/** 読込を始めた理由。完了したときに履歴をどう動かすかを決める。 */
export type LoadIntent =
  | {
      /** 新しい場所へ移る（本文のリンク、ツリー）。 */
      readonly kind: "push";
      readonly path: string;
      readonly anchor: string | null;
    }
  | {
      /** 戻る／進むで履歴の `index` の項目へ移る。 */
      readonly kind: "history";
      readonly index: number;
    };

/**
 * 文書の読込を始める。タブがなければ空の履歴で作る。
 *
 * 最初の読込が失敗したときにタブを残さないよう、履歴は読込の完了時に積む
 * （{@link completeLoad}）。
 */
export function startLoad(
  tab: DocumentTab | null,
  fresh: { readonly tabId: string; readonly scopeId: string },
  path: string,
): { tab: DocumentTab; token: LoadToken } {
  const base: DocumentTab = tab ?? {
    ...fresh,
    path,
    status: "loaded",
    loadGeneration: 0,
    history: { entries: [], index: 0 },
  };
  return beginLoad(base);
}

/**
 * 読込の成功をタブへ反映し、表示する位置を返す。
 *
 * 後から始めた読込やタブ内の移動で世代が進んでいれば、`undefined` を返して応答を捨てる。
 * `scrollTop` は離れる文書のスクロール位置であり、応答の時点で読む。読込を待つ間も
 * 利用者は前の文書を読んでいるためである。
 */
export function completeLoad(
  tab: DocumentTab,
  token: LoadToken,
  intent: LoadIntent,
  scrollTop: number,
): { tab: DocumentTab; view: ViewTarget } | undefined {
  if (!isCurrentLoad(tab, token) || tab.status === "deleted") return undefined;
  const loaded = applyLoadResult(tab, token, "succeeded");
  const left = updateCurrentScroll(tab.history, scrollTop);
  if (intent.kind === "push") {
    return {
      tab: {
        ...loaded,
        path: intent.path,
        history: pushHistoryEntry(left, {
          path: intent.path,
          anchor: intent.anchor,
          scrollTop: 0,
        }),
      },
      view: { anchor: intent.anchor, scrollTop: 0 },
    };
  }
  const entry = left.entries[intent.index];
  if (entry === undefined) {
    throw new Error(`履歴の位置 ${intent.index} に項目がありません`);
  }
  return {
    tab: {
      ...loaded,
      path: entry.path,
      history: { entries: left.entries, index: intent.index },
    },
    // 戻った先では見出しではなく、離れたときのスクロール位置へ戻す。
    view: { anchor: null, scrollTop: entry.scrollTop },
  };
}

/**
 * 読込の失敗をタブへ反映する。表示中の文書はそのまま保つ（7.2）。
 *
 * 戻る／進むで読めなかった項目は履歴から取り除く（9.3）。最初の読込が失敗して履歴が空の
 * ままなら、タブを閉じて `tab: null` を返す。応答が古ければ `undefined` を返す。
 */
export function failLoad(
  tab: DocumentTab,
  token: LoadToken,
  intent: LoadIntent,
): { tab: DocumentTab | null } | undefined {
  if (!isCurrentLoad(tab, token)) return undefined;
  if (intent.kind === "history") {
    return {
      tab: { ...tab, history: removeHistoryEntryAt(tab.history, intent.index) },
    };
  }
  return { tab: tab.history.entries.length === 0 ? null : tab };
}

/**
 * 表示中の文書の中で移る（見出しへのリンク、同じ文書をツリーから選ぶ）。
 *
 * 読込中の文書があれば、その応答を捨てる。ページ内の移動は利用者の新しい操作であり、
 * 後から届いた応答で表示を差し替えると操作が失われるためである。
 */
export function navigateWithin(
  tab: DocumentTab,
  anchor: string | null,
  scrollTop: number,
): { tab: DocumentTab; view: ViewTarget } {
  const { tab: invalidated } = beginLoad(tab);
  return {
    tab: {
      ...invalidated,
      history: pushHistoryEntry(updateCurrentScroll(tab.history, scrollTop), {
        path: tab.path,
        anchor,
        scrollTop: 0,
      }),
    },
    view: { anchor, scrollTop: 0 },
  };
}

/** 戻る／進むの結果。別の文書へ移るときは呼び出し側が読込を始める。 */
export type HistoryStep =
  | {
      readonly kind: "moved";
      readonly tab: DocumentTab;
      readonly view: ViewTarget;
    }
  | {
      readonly kind: "load";
      readonly path: string;
      readonly intent: LoadIntent;
    };

/**
 * 1つ戻る、または進む。端にいるときは `undefined` を返す。
 *
 * 移り先が表示中の文書なら読込なしで履歴を動かす。別の文書なら読込を求め、履歴は読込の
 * 完了時に動かす（{@link completeLoad}）。読めなかったときに現在位置を保つためである。
 */
export function stepHistory(
  tab: DocumentTab,
  direction: "back" | "forward",
  scrollTop: number,
): HistoryStep | undefined {
  const index = tab.history.index + (direction === "back" ? -1 : 1);
  const entry = tab.history.entries[index];
  if (entry === undefined) return undefined;
  if (entry.path !== tab.path) {
    return {
      kind: "load",
      path: entry.path,
      intent: { kind: "history", index },
    };
  }
  const { tab: invalidated } = beginLoad(tab);
  return {
    kind: "moved",
    tab: {
      ...invalidated,
      history: {
        entries: updateCurrentScroll(tab.history, scrollTop).entries,
        index,
      },
    },
    view: { anchor: null, scrollTop: entry.scrollTop },
  };
}
