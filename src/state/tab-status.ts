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
 * 実際のタブはタイトルやスクロール位置も持つが、この規則が見るのはパスと状態だけである。
 */
export type TrackedTab = {
  /** ワークスペース相対パス。loose tabでは暗黙のルートからの相対パス（design-decisions.md 9.1）。 */
  readonly path: string;
  readonly status: TabStatus;
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
  // 削除済みは終端状態とする。削除は debounce 窓で置換とrenameを除いてから確定するため、
  // ここへ来た時点でファイルは実際に失われている（design-decisions.md 6.4）。
  if (tab.status === "deleted") {
    return tab;
  }
  switch (event.kind) {
    case "fileModified":
      return event.path === tab.path ? { ...tab, status: "stale" } : tab;
    case "fileRemoved":
      return event.path === tab.path ? { ...tab, status: "deleted" } : tab;
    case "fileRenamed":
      // 内容は変わらないため状態は保つ。パスだけを新しいものへ追従させる。
      return event.oldPath === tab.path ? { ...tab, path: event.path } : tab;
    case "directoryChanged":
      return tab;
  }
}
