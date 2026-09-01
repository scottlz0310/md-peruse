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
 * 実際のタブはタイトルやスクロール位置も持つが、この規則が見るのはここに挙げた4つだけである。
 */
export type TrackedTab = {
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
  const change = event.change;
  switch (change.kind) {
    case "fileModified":
      return change.path === tab.path ? { ...tab, status: "stale" } : tab;
    case "fileRemoved":
      return change.path === tab.path ? { ...tab, status: "deleted" } : tab;
    case "fileRenamed":
      // 内容は変わらないため状態は保つ。パスだけを新しいものへ追従させる。
      return change.oldPath === tab.path ? { ...tab, path: change.path } : tab;
    case "directoryChanged":
      return tab;
  }
}

/**
 * 読込の開始を記録し、世代を進めたタブを返す。
 *
 * 呼び出し側は戻り値の `loadGeneration` を控え、応答を受け取ったときに
 * `applyLoadResult` へ渡す。
 */
export function beginLoad<T extends TrackedTab>(
  tab: T,
): Omit<T, keyof TrackedTab> & TrackedTab {
  return { ...tab, loadGeneration: tab.loadGeneration + 1 };
}

/** 読込の結果。失敗の原因はタブの状態とは別に保持する。 */
export type LoadOutcome = "succeeded" | "failed";

/**
 * 読込の応答をタブへ適用する。
 *
 * 開始時の世代が最新でない応答は破棄する。読込は非同期であり、完了の順序は開始の順序と
 * 一致しない。置換直後の再読込（6.5）は同じタブに対して短い間隔で2回の読込を走らせるため、
 * 先に始めた読込が後から完了して新しい内容を古い内容で上書きしうる。走査応答の世代（5.3）は
 * ディレクトリが対象であり、文書の読込は対象にしていない。
 *
 * 失敗した応答では状態を変えない。`stale` のまま留めることで、ユーザーが古い内容を最新と
 * 誤認せずに済む（design-decisions.md 6.5）。
 */
export function applyLoadResult<T extends TrackedTab>(
  tab: T,
  generation: number,
  outcome: LoadOutcome,
): Omit<T, keyof TrackedTab> & TrackedTab {
  if (generation !== tab.loadGeneration) {
    return tab;
  }
  // 読込中に削除が確定した場合は、届いた内容を反映しない。
  if (tab.status === "deleted" || outcome === "failed") {
    return tab;
  }
  return { ...tab, status: "loaded" };
}
