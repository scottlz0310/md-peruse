import { useMessages } from "../i18n/LanguageContext";
import type { DragState } from "../types/generated/DragState";

type Props = {
  state: DragState;
};

/**
 * ドラッグ中に、受け入れるかどうかを示すオーバーレイ（design-decisions.md 10.4）。
 *
 * 表示が必要なのは、対象外のファイルをドラッグしてもカーソルが常に「コピー可」になるためである
 * （wryのWindows実装は、ドロップ先の判断を待たない）。拒否をカーソルで示せない分を、文字で補う。
 * 色や線の種類だけに頼らず、どちらの場合も文言を出す。
 *
 * ウィンドウ全体を覆うが、操作を受けない（`pointer-events: none`）。ドロップ先の領域で処理を
 * 変えないため、オーバーレイもどこへドロップしても同じ結果になることを示す。
 */
export function DragOverlay({ state }: Props) {
  const messages = useMessages();
  if (state === "idle") return null;
  return (
    <div className="drag-overlay" data-state={state} role="status">
      <p>
        {state === "acceptable"
          ? messages.dragOverlay.acceptable
          : messages.dragOverlay.rejected}
      </p>
    </div>
  );
}
