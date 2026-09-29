import { type RefObject, useEffect } from "react";

/**
 * 要素の大きさが変わったときに `onResize` を呼ぶ。観測を始めたときにも1回呼ばれる。
 *
 * 呼び出しのたびに観測し直さないよう、`onResize` は参照を保つこと（`useCallback`）。
 */
export function useResizeObserver(
  target: RefObject<Element | null>,
  onResize: () => void,
) {
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const observer = new ResizeObserver(onResize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, onResize]);
}
