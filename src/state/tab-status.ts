import type { FileChangeEvent } from "../types/generated/FileChangeEvent";

/**
 * タブが表示している内容と、ディスク上のファイルとの関係。
 *
 * 本アプリはRead-onlyであり、編集による未保存状態は存在しない。ここでの
 * `stale` は、外部でファイルが変更され再読込が必要になった状態を指す
 * （design-decisions.md 6.5、9.1）。
 */
export type TabStatus =
  /** 最後に読み込んだ内容が最新である。 */
  | "loaded"
  /** 外部で変更された。アクティブになった時点で再読込する。 */
  | "stale"
  /** 削除が確定した。以後の再読込を停止し、最後に読めた内容を表示したままにする。 */
  | "deleted";

/**
 * ファイル変更イベントの適用対象となるタブ。
 *
 * 実際のタブはタイトルやスクロール位置も持つが、この規則が見るのはここに挙げた5つだけである。
 */
export type TrackedTab = {
  /**
   * タブのインスタンスID。タブを開くたびに採番し、閉じたタブのIDは再利用しない。
   *
   * 同じパスのタブを閉じて開き直すと、状態は初期値へ戻る。読込世代だけでは、閉じた
   * タブの遅れた応答が新しいタブの世代と一致してしまう（design-decisions.md 6.5）。
   */
  readonly tabId: string;
  /**
   * このタブが属するスコープ（ワークスペース、またはloose tabの暗黙のルート）の不透明なID。
   *
   * `path` はスコープからの相対パスであり、それだけではタブを一意にできない
   * （design-decisions.md 6.4）。
   */
  readonly scopeId: string;
  /** スコープのルートからの相対パス。 */
  readonly path: string;
  readonly status: TabStatus;
  /**
   * 読込を開始するたびに進める世代。応答の陳腐化の判定に使う（design-decisions.md 6.5）。
   */
  readonly loadGeneration: number;
};

/**
 * ファイル変更イベントをタブへ適用し、次の状態を返す。
 *
 * 変更がないときは受け取ったタブをそのまま返す。
 *
 * アクティブかどうかで結果を変えないのは、再読込という副作用を状態から切り離すためである。
 * 呼び出し側は「アクティブタブが `stale` になったら再読込し、成功したら `loaded` へ戻す」
 * という1つの規則で駆動でき、再読込に失敗したタブは `stale` のまま留まる
 * （design-decisions.md 6.4、6.5）。
 */
export function applyFileChange<T extends TrackedTab>(
  tab: T,
  event: FileChangeEvent,
  // 戻り値で `path` と `status` を上書きするため、呼び出し側が持つ型の
  // リテラル（`status: "loaded"` など）をそのまま返さない。
): Omit<T, keyof TrackedTab> & TrackedTab {
  // 停止済みのWatcherが停止前に送出したイベントや、別のloose tabのイベントが
  // 同じ相対パスで届きうる。スコープが一致しないイベントは破棄する
  // （design-decisions.md 6.4）。
  if (event.scopeId !== tab.scopeId) {
    return tab;
  }
  // 削除済みは終端状態とする。削除は debounce 窓で置換とrenameを除いてから確定するため、
  // ここへ来た時点でファイルは実際に失われている（design-decisions.md 6.4）。
  if (tab.status === "deleted") {
    return tab;
  }
  // 変更を受理したときは読込世代も進める。進行中の読込があると、その応答は
  // 変更より前の内容であり、完了しても反映してはならない（design-decisions.md 6.5）。
  const invalidated = tab.loadGeneration + 1;
  const change = event.change;
  switch (change.kind) {
    case "fileModified":
      return change.path === tab.path
        ? { ...tab, status: "stale", loadGeneration: invalidated }
        : tab;
    case "fileRemoved":
      return change.path === tab.path
        ? { ...tab, status: "deleted", loadGeneration: invalidated }
        : tab;
    case "fileRenamed":
      // 内容は変わらないため状態は保つ。パスだけを新しいものへ追従させる。
      // 進行中の読込は旧パスに対するものであり、応答は受理しない。
      return change.oldPath === tab.path
        ? { ...tab, path: change.path, loadGeneration: invalidated }
        : tab;
    case "directoryChanged":
      return tab;
  }
}

/**
 * 進行中の読込を識別するトークン。
 *
 * タブのインスタンスIDを含めるのは、世代だけでは同じパスのタブを閉じて開き直した場合を
 * 区別できないためである。閉じたタブで始めた読込の応答が、同じ世代に戻った新しいタブへ
 * 反映されてしまう（design-decisions.md 6.5）。
 */
export type LoadToken = {
  readonly tabId: string;
  readonly generation: number;
};

/**
 * 読込の開始を記録し、世代を進めたタブと、その読込のトークンを返す。
 *
 * 呼び出し側はトークンを控え、応答を受け取ったときに `applyLoadResult` へ渡す。
 */
export function beginLoad<T extends TrackedTab>(
  tab: T,
): { tab: Omit<T, keyof TrackedTab> & TrackedTab; token: LoadToken } {
  const generation = tab.loadGeneration + 1;
  return {
    tab: { ...tab, loadGeneration: generation },
    token: { tabId: tab.tabId, generation },
  };
}

/** 読込の結果。失敗の原因はタブの状態とは別に保持する。 */
export type LoadOutcome = "succeeded" | "failed";

/**
 * 読込の応答をタブへ適用する。
 *
 * トークンがタブの現在のインスタンスと世代の両方に一致する応答だけを反映する。読込は
 * 非同期であり、完了の順序は開始の順序と一致しない。世代が進むのは次の2つの場合であり、
 * どちらも進行中の読込の応答を無効にする。
 *
 * - 同じタブに対して次の読込を始めたとき。置換直後の再読込（6.5）は短い間隔で2回の読込を
 *   走らせるため、先に始めた読込が後から完了して新しい内容を古い内容で上書きしうる。
 * - 進行中の読込があるうちに、そのタブが変更・削除・renameを受理したとき。次の読込を
 *   始める前に前の読込が完了すると、変更より前の内容を最新として受理してしまう。
 *
 * 走査応答の世代（5.3）はディレクトリが対象であり、文書の読込は対象にしていない。
 *
 * 失敗した応答では状態を変えない。`stale` のまま留めることで、ユーザーが古い内容を最新と
 * 誤認せずに済む（design-decisions.md 6.5）。
 */
export function applyLoadResult<T extends TrackedTab>(
  tab: T,
  token: LoadToken,
  outcome: LoadOutcome,
): Omit<T, keyof TrackedTab> & TrackedTab {
  // 閉じたタブの応答は、同じパスで開き直した新しいタブへ反映しない。
  if (token.tabId !== tab.tabId || token.generation !== tab.loadGeneration) {
    return tab;
  }
  // 読込中に削除が確定した場合は、届いた内容を反映しない。
  if (tab.status === "deleted" || outcome === "failed") {
    return tab;
  }
  return { ...tab, status: "loaded" };
}
