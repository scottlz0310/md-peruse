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

/** 親フォルダーのパス。ルート直下は `ROOT_PATH`。 */
function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? ROOT_PATH : path.slice(0, slash);
}

/** 親フォルダーの取得結果に載っている項目。 */
function listedNode(tree: FileTree, path: string): FileNode | undefined {
  const parent = tree.directories.get(parentPath(path));
  return parent?.status === "loaded"
    ? parent.entries.find((node) => node.path === path)
    : undefined;
}

/** フォルダーの取得結果を捨てる。次に展開したときに取り直させる。走査中の応答も無効にする。 */
function discard(tree: FileTree, path: string): FileTree {
  const directories = new Map(tree.directories);
  directories.delete(path);
  const pathGenerations = new Map(tree.pathGenerations).set(
    path,
    (tree.pathGenerations.get(path) ?? 0) + 1,
  );
  return { ...tree, directories, pathGenerations };
}

/** 展開して見えているフォルダーか。ルートは常に見えている。 */
function isOpen(tree: FileTree, path: string): boolean {
  return path === ROOT_PATH || tree.expanded.has(path);
}

/** ツリーの更新の結果。`rescan` のフォルダーを取り直す。 */
export type TreeRefresh = {
  readonly tree: FileTree;
  readonly rescan: readonly string[];
};

/**
 * フォルダーの子要素が増減した通知を受けたときの更新（design-decisions.md 6.4）。
 *
 * 展開しているフォルダーは、その階層だけを取り直す。ルート全体は取り直さない。取得済みで
 * 畳んでいるフォルダーは取得結果を捨て、次に展開したときに取り直させる。畳んだまま取り直すと、
 * 開かれないかもしれないフォルダーのために走査が走る。取得していないフォルダーは何もしない。
 * 失敗したフォルダーも、展開のたびに取り直すため何もしない。
 *
 * 取得していない、`hasChildren: false` のフォルダーに子ができたときだけ、親を取り直す。
 * 展開矢印は親の走査で決まるため（6.2）、取り直さないと、初めてファイルができたフォルダーが
 * 展開できないまま残る。
 */
export function refreshDirectory(tree: FileTree, path: string): TreeRefresh {
  const state = tree.directories.get(path);
  if (state === undefined) {
    const listed = listedNode(tree, path);
    return listed?.kind === "directory" && listed.hasChildren === false
      ? refreshDirectory(tree, parentPath(path))
      : { tree, rescan: [] };
  }
  if (state.status === "failed") return { tree, rescan: [] };
  return isOpen(tree, path)
    ? { tree, rescan: [path] }
    : { tree: discard(tree, path), rescan: [] };
}

/**
 * 変更を個別に追えないとき（`watcherOverflow`、`watcherStopped`）の更新。取得済みのすべての
 * フォルダーへ、`refreshDirectory` と同じ規則を当てる（6.4）。
 */
export function refreshAllDirectories(tree: FileTree): TreeRefresh {
  let next = tree;
  const rescan: string[] = [];
  for (const path of tree.directories.keys()) {
    const refreshed = refreshDirectory(next, path);
    next = refreshed.tree;
    rescan.push(...refreshed.rescan);
  }
  return { tree: next, rescan };
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

/**
 * ルート直下から `path` までの各階層のパスを、ルートに近い順に並べる。ルート自身は
 * 含めない。`docs/guide/a.md` なら `docs`、`docs/guide`、`docs/guide/a.md` となる。
 */
export function pathChain(path: string): string[] {
  if (path === ROOT_PATH) return [];
  const names = path.split("/");
  return names.map((_, index) => names.slice(0, index + 1).join("/"));
}

/**
 * フォルダーをツリーで見せるとき、いまフォーカスを置く項目（パンくず。10.1.1）。
 *
 * `path` が見えていればその項目、見えていなければ見えている最も近い祖先を返す。ルートは
 * 項目ではないため、先頭の項目を指す。`done` は、これ以上待っても置き場所が変わらないか
 * である。祖先の走査が終わるまでは `false` とし、走査に失敗した祖先があればそこで止まる。
 */
export function revealFocus(
  tree: FileTree,
  path: string,
): { path: string | null; done: boolean } {
  const visible = new Set(visibleNodes(tree).map(({ node }) => node.path));
  const chain = pathChain(path);
  const ancestors = [ROOT_PATH, ...chain.slice(0, -1)];
  const loading = ancestors.some(
    (folder) => tree.directories.get(folder)?.status === "loading",
  );
  if (path === ROOT_PATH) {
    const [first] = visible;
    return { path: first ?? null, done: first !== undefined || !loading };
  }
  const nearest = chain.filter((folder) => visible.has(folder)).at(-1) ?? null;
  return { path: nearest, done: nearest === path || !loading };
}
