import { type KeyboardEvent, useRef } from "react";
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
 * 中クリックと閉じるボタンでタブを閉じる。
 */
export function TabBar({ set, onActivate, onClose, onPin }: Props) {
  const elements = useRef(new Map<string, HTMLDivElement>());

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
    <div role="tablist" aria-label="開いている文書" className="tab-bar">
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
