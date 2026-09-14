import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clampSidebarWidth,
  effectiveMaxSidebarWidth,
  MIN_SIDEBAR_WIDTH,
  nextSidebarWidth,
} from "../state/sidebar-width";

type Props = {
  /** 設定から読んだサイドバー幅（保存値）。 */
  savedWidth: number;
  /** サイドバーを表示するか。幅とは独立に持つ（10.2）。 */
  sidebarVisible: boolean;
  /**
   * 利用者が幅を決めたときに呼ぶ。キー操作では変更ごと、ドラッグでは離したときに呼ぶ。
   * 値は操作した時点のウィンドウ幅で範囲へ収めてある。
   */
  onWidthCommit: (width: number) => void;
  sidebar: ReactNode;
  /** プレビュー領域の中身。 */
  children: ReactNode;
  /** プレビュー領域の要素。スクロール位置の読み書き（9.3）に使う。 */
  previewRef?: Ref<HTMLElement>;
};

/**
 * サイドバー、境界、プレビュー領域の2ペイン（design-decisions.md 10.2）。
 *
 * 保存値と実効値を分けて持つ。ウィンドウを縮めて上限を下回ったときは表示だけを詰め、
 * 保存値は変えない。広げ直したときに元の幅へ戻すためである。
 *
 * 幅はCSSカスタムプロパティとして `style` 要素へ書く。CSPが `style` 属性を許可しない
 * ためである（5.5）。
 */
export function SidebarLayout({
  savedWidth,
  sidebarVisible,
  onWidthCommit,
  sidebar,
  children,
  previewRef,
}: Props) {
  const [width, setWidth] = useState(savedWidth);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const dragging = useRef(false);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const effective = clampSidebarWidth(width, windowWidth);
  const max = effectiveMaxSidebarWidth(windowWidth);

  function commit(next: number) {
    setWidth(next);
    onWidthCommit(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight":
        next = nextSidebarWidth(
          effective,
          event.key === "ArrowRight" ? 1 : -1,
          windowWidth,
          event.shiftKey,
        );
        break;
      case "Home":
        next = MIN_SIDEBAR_WIDTH;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    commit(next);
  }

  function widthAt(event: PointerEvent<HTMLDivElement>) {
    const layout = event.currentTarget.parentElement;
    const left = layout?.getBoundingClientRect().left ?? 0;
    return clampSidebarWidth(event.clientX - left, windowWidth);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    // ドラッグ中の文字列選択を止める。既定動作を止めるとフォーカスも移らないため、
    // 掴んだ後にキーで微調整できるよう明示的に移す。
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (dragging.current) setWidth(widthAt(event));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    commit(widthAt(event));
  }

  return (
    <div
      className="sidebar-layout"
      data-sidebar={sidebarVisible ? "visible" : "hidden"}
    >
      <style>{`.sidebar-layout { --sidebar-width: ${effective}px; }`}</style>
      {sidebarVisible && (
        <>
          <nav className="sidebar" aria-label="エクスプローラー">
            {sidebar}
          </nav>
          {/* biome-ignore lint/a11y/useSemanticElements: `hr` はフォーカスとキー操作を持てない。ペイン境界は操作できる区切りであり、`role="separator"` にARIAの値を載せる（10.2）。 */}
          <div
            className="resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="サイドバーの幅"
            aria-valuenow={effective}
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={max}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </>
      )}
      <main ref={previewRef} className="preview-area">
        {children}
      </main>
    </div>
  );
}
