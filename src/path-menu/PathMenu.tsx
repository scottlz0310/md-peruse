import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useMessages } from "../i18n/LanguageContext";

export type PathFormat =
  import("../types/generated/CopyPathFormat").CopyPathFormat;
type Target = {
  opener: HTMLElement;
  x: number;
  y: number;
  relative: boolean;
  copy: (format: PathFormat) => Promise<void>;
};

export function usePathMenu() {
  const [target, setTarget] = useState<Target | null>(null);
  function open(
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    relative: boolean,
    copy: Target["copy"],
  ) {
    event.preventDefault();
    event.stopPropagation();
    const opener = event.currentTarget;
    const rect = opener.getBoundingClientRect();
    setTarget({
      opener,
      x: "clientX" in event ? event.clientX : rect.left,
      y: "clientY" in event ? event.clientY : rect.bottom,
      relative,
      copy,
    });
  }
  return {
    open,
    menu:
      target &&
      createPortal(
        <PathMenu target={target} onClose={() => setTarget(null)} />,
        document.body,
      ),
  };
}

export function isContextMenuKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

function PathMenu({
  target,
  onClose,
}: {
  target: Target;
  onClose: () => void;
}) {
  const messages = useMessages().pathCopy;
  const menu = useRef<HTMLDivElement>(null);
  const id = `path-menu-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [position, setPosition] = useState({ x: target.x, y: target.y });
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      x: Math.max(0, Math.min(target.x, window.innerWidth - rect.width)),
      y: Math.max(0, Math.min(target.y, window.innerHeight - rect.height)),
    });
    element.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !element.contains(event.target))
        onClose();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [target, onClose]);

  function close() {
    onClose();
    if (target.opener.isConnected) target.opener.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    const buttons = Array.from(menu.current?.querySelectorAll("button") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case "Escape":
      case "Tab":
        event.preventDefault();
        close();
        return;
      case "ArrowDown":
        buttons[(index + 1) % buttons.length]?.focus();
        break;
      case "ArrowUp":
        buttons[(index - 1 + buttons.length) % buttons.length]?.focus();
        break;
      case "Home":
        buttons[0]?.focus();
        break;
      case "End":
        buttons.at(-1)?.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  }
  const formats: PathFormat[] = target.relative
    ? ["absolute", "relative"]
    : ["absolute"];
  return (
    <>
      <style>{`#${id} { left: ${position.x}px; top: ${position.y}px; }`}</style>
      <div
        ref={menu}
        id={id}
        role="menu"
        aria-label={messages.menu}
        className="path-menu"
        onKeyDown={keyDown}
      >
        {formats.map((format) => (
          <button
            key={format}
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              void target.copy(format);
            }}
          >
            {messages[format]}
          </button>
        ))}
      </div>
    </>
  );
}
