import { type KeyboardEvent, useCallback, useEffect, useRef } from "react";
import { useResizeObserver } from "../layout/use-resize-observer";
import { type TabSet, tabTitle } from "../state/tab-set";

type Props = {
  set: TabSet;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  /** プレビュータブを固定する（タブのダブルクリック）。 */
  onPin: (tabId: string) => void;
};

/** タブの要素のID。プレビュー領域の `aria-labelledby` から参照する。 */
export function tabElementId(tabId: string): string {
  return `document-tab-${tabId}`;
}

/**
 * タブバー（design-decisions.md 9.1、10章）。
 *
 * WAI-ARIAのtabsパターンに従う。`←` / `→` でフォーカスを移しながらアクティブにし
 * （自動アクティブ化）、`Home` / `End` で端へ移る。プレビュータブは斜体で示す。
 * 中クリックと閉じるボタンでタブを閉じる。幅に収まらないタブは横にスクロールし、
 * アクティブなタブは、変わったときと幅が変わったときに、見える位置へ動かす。
 */
export function TabBar({ set, onActivate, onClose, onPin }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLDivElement>());

  // 矢印キーは `focus()` で動くが、ツリーからの新規オープン、`Ctrl+Tab`、タブを閉じた後の
  // 切り替えは動かさないため、画面外のタブがアクティブになる。ウィンドウを狭めたときも、
  // 右端にあったアクティブなタブが隠れる。アニメーションはしない。
  const reveal = useCallback(() => {
    if (set.activeTabId === null) return;
    elements.current
      .get(set.activeTabId)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [set.activeTabId]);
  useEffect(reveal, [reveal]);
  useResizeObserver(list, reveal);

  function move(tabId: string | undefined) {
    if (tabId === undefined) return;
    onActivate(tabId);
    elements.current.get(tabId)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const { tabs } = set;
    switch (event.key) {
      case "ArrowRight":
        move(tabs[(index + 1) % tabs.length]?.tabId);
        break;
      case "ArrowLeft":
        move(tabs[(index - 1 + tabs.length) % tabs.length]?.tabId);
        break;
      case "Home":
        move(tabs[0]?.tabId);
        break;
      case "End":
        move(tabs[tabs.length - 1]?.tabId);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div
      ref={list}
      role="tablist"
      aria-label="開いている文書"
      className="tab-bar"
    >
      {set.tabs.map((tab, index) => {
        const active = tab.tabId === set.activeTabId;
        return (
          <div
            key={tab.tabId}
            ref={(element) => {
              if (element) elements.current.set(tab.tabId, element);
              else elements.current.delete(tab.tabId);
            }}
            id={tabElementId(tab.tabId)}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={tab.preview ? "tab tab-preview" : "tab"}
            title={tab.path}
            onClick={() => onActivate(tab.tabId)}
            onDoubleClick={() => onPin(tab.tabId)}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              event.preventDefault();
              onClose(tab.tabId);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="tab-title">{tabTitle(tab)}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={`${tabTitle(tab)} を閉じる`}
              tabIndex={-1}
              onClick={(event) => {
                // タブのクリック（アクティブ化）へ伝えない。
                event.stopPropagation();
                onClose(tab.tabId);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
