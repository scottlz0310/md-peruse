import { useSyncExternalStore } from "react";

/**
 * 印刷中かどうか（design-decisions.md 10.7）。
 *
 * 印刷では画面のテーマに依存させない。画面がダークでも、図は白地に合う配色で描き直す必要が
 * あり、CSSだけでは切り替えられない箇所（Mermaidの図）のために、描画側へ状態として渡す。
 */
let printing = false;
const listeners = new Set<() => void>();

export function setPrinting(value: boolean): void {
  if (printing === value) return;
  printing = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 印刷の準備中から、印刷ダイアログを閉じるまで `true` を返す。 */
export function usePrinting(): boolean {
  return useSyncExternalStore(subscribe, () => printing);
}
