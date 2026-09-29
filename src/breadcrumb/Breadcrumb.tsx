import { useCallback, useLayoutEffect, useRef } from "react";
import { useResizeObserver } from "../layout/use-resize-observer";
import { pathChain, ROOT_PATH } from "../state/file-tree";

type Props = {
  /** ワークスペースの表示名。先頭のセグメントに出す。 */
  rootLabel: string;
  /** 表示中の文書の、ワークスペースのルートからの相対パス。 */
  path: string;
  /** フォルダーのセグメントを選んだ。先頭のセグメントは `ROOT_PATH` を渡す。 */
  onSelect: (folder: string) => void;
};

/**
 * 表示中の文書のパンくず（design-decisions.md 10.1.1）。
 *
 * WAI-ARIAのbreadcrumbパターンに従う。フォルダーのセグメントはボタンとし、選ぶとツリーで
 * そのフォルダーを見せる。最後のセグメント（表示中の文書）は選択済みであり、操作を持たない。
 * 幅に収まらないときは、表示中の文書名が見えるよう末尾へスクロールする。パスが変わった
 * ときと幅が変わったときに動かし、それ以外は、手で動かした位置を保つ。
 */
export function Breadcrumb({ rootLabel, path, onSelect }: Props) {
  const nav = useRef<HTMLElement>(null);
  const scrollToEnd = useCallback(() => {
    const element = nav.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, []);

  // 描画の前に動かし、先頭が一瞬見えるちらつきを避ける。
  // biome-ignore lint/correctness/useExhaustiveDependencies: パスやワークスペース名が変わったときにだけ末尾へ動かす。
  useLayoutEffect(scrollToEnd, [path, rootLabel]);
  useResizeObserver(nav, scrollToEnd);

  const chain = pathChain(path);
  const folders = [
    { path: ROOT_PATH, name: rootLabel },
    ...chain.slice(0, -1).map((folder) => ({
      path: folder,
      name: folder.slice(folder.lastIndexOf("/") + 1),
    })),
  ];
  return (
    <nav ref={nav} className="breadcrumb" aria-label="パンくずリスト">
      <ol>
        {folders.map((folder) => (
          <li key={folder.path}>
            <button type="button" onClick={() => onSelect(folder.path)}>
              {folder.name}
            </button>
            <span className="breadcrumb-separator" aria-hidden="true">
              ›
            </span>
          </li>
        ))}
        <li>
          <span aria-current="page">
            {path.slice(path.lastIndexOf("/") + 1)}
          </span>
        </li>
      </ol>
    </nav>
  );
}
