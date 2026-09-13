import {
  type RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  FIND_ACTIVE_HIGHLIGHT_NAME,
  FIND_HIGHLIGHT_NAME,
  type FindDirection,
  MAX_FIND_MATCHES,
  stepMatchIndex,
} from "../state/find";
import { collectFindRanges } from "./find-ranges";

/** 一致の範囲を画面へ示す先。製品では CSS Custom Highlight API。 */
export type FindHighlights = {
  set(name: string, ranges: readonly Range[]): void;
  delete(name: string): void;
};

const cssHighlights: FindHighlights = {
  set: (name, ranges) => {
    CSS.highlights.set(name, new Highlight(...ranges));
  },
  delete: (name) => {
    CSS.highlights.delete(name);
  },
};

const FORCED_COLORS = "(forced-colors: active)";

function subscribeForcedColors(onChange: () => void): () => void {
  const query = matchMedia(FORCED_COLORS);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isForcedColors(): boolean {
  return matchMedia(FORCED_COLORS).matches;
}

type Props = {
  /** 検索の対象とするプレビュー本文。 */
  root: RefObject<HTMLElement | null>;
  /** テストでハイライトの登録を差し替えるために受け取る。 */
  highlights?: FindHighlights;
};

/**
 * 文書内検索（design-decisions.md 8.6）。
 *
 * `Ctrl+F` と `F3` はWebView2標準の検索バーを開くため、開いていない間も奪う。本文の
 * DOMは描画後にも入れ替わる（コードハイライト、Mermaidの図、テーマ変更、文書の差し替え）
 * ため、検索中は本文を監視して同じ検索語で探し直す。
 */
export function DocumentFind({ root, highlights = cssHighlights }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Range[]>([]);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<Element | null>(null);
  const forcedColors = useSyncExternalStore(
    subscribeForcedColors,
    isForcedColors,
  );

  function openFind() {
    if (!open) returnFocusRef.current = document.activeElement;
    setOpen(true);
    focusInput(inputRef.current);
  }

  function closeFind() {
    setOpen(false);
    const returnFocus = returnFocusRef.current;
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
      returnFocus.focus();
    }
  }

  function step(direction: FindDirection) {
    const next = stepMatchIndex(matches.length, active, direction);
    setActive(next);
    const range = matches[next];
    if (range !== undefined) reveal(range);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() === "f" &&
        event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        openFind();
      } else if (event.key === "F3") {
        event.preventDefault();
        if (open) step(event.shiftKey ? "previous" : "next");
        else openFind();
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        closeFind();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    if (open) focusInput(inputRef.current);
  }, [open]);

  useEffect(() => {
    const element = root.current;
    if (!open || element === null) {
      setMatches([]);
      setActive(-1);
      return;
    }
    const found = collectFindRanges(element, query);
    setMatches(found);
    setActive(found.length > 0 ? 0 : -1);
    const first = found[0];
    if (first !== undefined) reveal(first);

    // 変化は1フレーム分まとめて探し直す。読んでいる位置を動かさないよう、ここでは
    // スクロールしない。
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const refound = collectFindRanges(element, query);
        setMatches(refound);
        setActive((current) =>
          refound.length === 0
            ? -1
            : Math.min(Math.max(current, 0), refound.length - 1),
        );
      });
    });
    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, query, root]);

  useEffect(() => {
    if (!open) return;
    // 現在位置は全体のハイライトから外し、重なりの描画順に依存させない。
    // `forced-colors` ではChromiumがどのハイライトも `Highlight` の色へ置き換え、
    // 作者の配色も装飾も効かない（実測）。全体を登録すると現在位置を見分けられないため、
    // 現在位置だけを示す。
    highlights.set(
      FIND_HIGHLIGHT_NAME,
      forcedColors ? [] : matches.filter((_, index) => index !== active),
    );
    const current = matches[active];
    highlights.set(
      FIND_ACTIVE_HIGHLIGHT_NAME,
      current === undefined ? [] : [current],
    );
    return () => {
      highlights.delete(FIND_HIGHLIGHT_NAME);
      highlights.delete(FIND_ACTIVE_HIGHLIGHT_NAME);
    };
  }, [open, matches, active, highlights, forcedColors]);

  if (!open) return null;

  return (
    <search className="find-bar">
      <input
        ref={inputRef}
        type="text"
        aria-label="文書内を検索"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          step(event.shiftKey ? "previous" : "next");
        }}
      />
      <output className="find-count" aria-live="polite">
        {countLabel(query, matches.length, active)}
      </output>
      <button
        type="button"
        aria-label="前の一致"
        onClick={() => step("previous")}
      >
        ↑
      </button>
      <button type="button" aria-label="次の一致" onClick={() => step("next")}>
        ↓
      </button>
      <button type="button" aria-label="検索を閉じる" onClick={closeFind}>
        ×
      </button>
    </search>
  );
}

function countLabel(query: string, count: number, active: number): string {
  if (query.length === 0) return "";
  if (count === 0) return "一致なし";
  // 上限で探索を打ち切ったときは、それ以降にも一致がありうることを示す。
  const total = count >= MAX_FIND_MATCHES ? `${count}+` : `${count}`;
  return `${active + 1} / ${total}`;
}

function focusInput(input: HTMLInputElement | null) {
  input?.focus();
  input?.select();
}

function reveal(range: Range) {
  range.startContainer.parentElement?.scrollIntoView({
    block: "center",
    inline: "nearest",
  });
}
