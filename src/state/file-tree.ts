import type { FileNode } from "../types/generated/FileNode";

/**
 * サイドバーのファイルツリーの状態（design-decisions.md 5.3、6.2）。
 *
 * ルート直下だけを最初に取得し、フォルダーは展開したときに取得する。取得済みの結果は
 * ワークスペースを開いている間だけ保持する。
 *
 * 陳腐化した走査の応答は2層の世代で捨てる（5.3）。
 *
 * - ワークスペース世代: ワークスペースを開き直すたびに新しいツリーを作り、世代を進める。
 *   旧ツリーのパス世代の記録ごと捨てるため、同じ相対パスの応答でも旧ワークスペースの
 *   ものは反映しない。
 * - パス世代: 同じパスの走査を始めるたびに進める。別のパスの走査は互いに無効化しない。
 *
 * 応答に含まれる `path` は判定に使わない。同じパスの再走査とワークスペースの切り替えを
 * 区別できないためである。
 */

/** ルート直下のパス。 */
export const ROOT_PATH = "";

/** 1つのフォルダーの取得状態。 */
export type DirectoryState =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly entries: readonly FileNode[] }
  /** 走査に失敗した。ツリー全体ではなく該当するフォルダーに表示する（6.2）。 */
  | { readonly status: "failed"; readonly message: string };

export type FileTree = {
  readonly workspaceGeneration: number;
  readonly directories: ReadonlyMap<string, DirectoryState>;
  readonly pathGenerations: ReadonlyMap<string, number>;
  /** 展開しているフォルダー。ルートは常に展開して表示するため含めない。 */
  readonly expanded: ReadonlySet<string>;
};

/** 走査を始めたときに控える値。応答の反映時に照合する。 */
export type ScanToken = {
  readonly workspaceGeneration: number;
  readonly path: string;
  readonly pathGeneration: number;
};

/** ワークスペースを開いたときの空のツリーを作る。 */
export function createFileTree(workspaceGeneration: number): FileTree {
  return {
    workspaceGeneration,
    directories: new Map(),
    pathGenerations: new Map(),
    expanded: new Set(),
  };
}

/**
 * フォルダーの走査を始める。
 *
 * 取得済みのフォルダーを再走査するときは、応答が届くまで前の結果を表示し続ける。
 */
export function beginScan(
  tree: FileTree,
  path: string,
): { tree: FileTree; token: ScanToken } {
  const pathGeneration = (tree.pathGenerations.get(path) ?? 0) + 1;
  const pathGenerations = new Map(tree.pathGenerations).set(
    path,
    pathGeneration,
  );
  const directories = new Map(tree.directories);
  if (directories.get(path)?.status !== "loaded") {
    directories.set(path, { status: "loading" });
  }
  return {
    tree: { ...tree, directories, pathGenerations },
    token: {
      workspaceGeneration: tree.workspaceGeneration,
      path,
      pathGeneration,
    },
  };
}

/** 応答が、いま表示しているツリーの最新の走査に対するものか。 */
export function isCurrentScan(tree: FileTree, token: ScanToken): boolean {
  return (
    token.workspaceGeneration === tree.workspaceGeneration &&
    tree.pathGenerations.get(token.path) === token.pathGeneration
  );
}

/**
 * 走査の結果を反映する。陳腐化した応答なら `undefined` を返し、ツリーを変えない。
 */
export function applyScanResult(
  tree: FileTree,
  token: ScanToken,
  result:
    | { readonly entries: readonly FileNode[] }
    | { readonly message: string },
): FileTree | undefined {
  if (!isCurrentScan(tree, token)) return undefined;
  const state: DirectoryState =
    "entries" in result
      ? { status: "loaded", entries: result.entries }
      : { status: "failed", message: result.message };
  return {
    ...tree,
    directories: new Map(tree.directories).set(token.path, state),
  };
}

/** フォルダーの展開状態を切り替える。 */
export function setExpanded(
  tree: FileTree,
  path: string,
  expanded: boolean,
): FileTree {
  if (tree.expanded.has(path) === expanded) return tree;
  const next = new Set(tree.expanded);
  if (expanded) next.add(path);
  else next.delete(path);
  return { ...tree, expanded: next };
}

/**
 * 展開したときに走査が要るか。未取得のフォルダーと、前回の走査に失敗したフォルダーは
 * 取得し直す。読込中のフォルダーは重ねて要求しない。
 */
export function needsScan(tree: FileTree, path: string): boolean {
  const state = tree.directories.get(path);
  return state === undefined || state.status === "failed";
}

/**
 * 展開できる項目か。子を持たないと判定されたフォルダー（`hasChildren: false`）は
 * 展開矢印を出さず、ファイルと同じく展開の操作を受けない（6.2「展開矢印の有無」）。
 * 読めなかったフォルダーはRust側が `true` を返すため、展開を試せる。
 */
export function isExpandable(node: FileNode): boolean {
  return node.kind === "directory" && node.hasChildren !== false;
}

/** 画面に見えている項目。キーボードでの移動順に並べる。 */
export type VisibleNode = {
  readonly node: FileNode;
  /** ルート直下を1とする階層。 */
  readonly level: number;
  /** 親フォルダーのパス。ルート直下は `ROOT_PATH`。 */
  readonly parent: string;
};

/** 展開しているフォルダーの中身を深さ優先で並べる。 */
export function visibleNodes(tree: FileTree): VisibleNode[] {
  const result: VisibleNode[] = [];
  const walk = (path: string, level: number) => {
    const state = tree.directories.get(path);
    if (state?.status !== "loaded") return;
    for (const node of state.entries) {
      result.push({ node, level, parent: path });
      if (isExpandable(node) && tree.expanded.has(node.path)) {
        walk(node.path, level + 1);
      }
    }
  };
  walk(ROOT_PATH, 1);
  return result;
}
