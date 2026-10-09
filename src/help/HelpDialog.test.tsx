import { afterEach, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { Language } from "../types/generated/Language";
import { HELP } from "./content";
import { HelpDialog } from "./HelpDialog";

afterEach(cleanup);

test.each(["ja", "en"] as const)(
  "%s: 目次・図解・操作例・ショートカットを同梱する",
  (language: Language) => {
    const content = HELP[language];
    const onClose = mock(() => {});
    const result = render(<HelpDialog language={language} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: content.title });
    expect(dialog.getAttribute("lang")).toBe(language);
    expect(dialog.hasAttribute("open")).toBe(true);
    const nav = screen.getByRole("navigation", { name: content.contents });
    for (const section of content.sections) {
      expect(
        within(nav).getByRole("button", { name: section.title }),
      ).toBeTruthy();
      expect(
        screen.getByRole("heading", {
          name: new RegExp(
            section.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ),
        }),
      ).toBeTruthy();
      if (section.example)
        expect(screen.getByText(section.example)).toBeTruthy();
    }
    for (const caption of Object.values(content.diagram.captions)) {
      expect(screen.getByRole("img", { name: caption })).toBeTruthy();
    }
    expect(screen.getByText("Ctrl+O")).toBeTruthy();
    expect(
      dialog.querySelectorAll("img[src], iframe, a[href^='http']"),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: content.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
    result.unmount();
  },
);

test("目次から対象見出しへ移動し、閉じた後は元の要素へ戻す", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const result = render(<HelpDialog language="ja" onClose={() => {}} />);
  const heading = screen.getByRole("heading", { name: /文書の場所をAIへ渡す/ });
  const scroll = mock(() => {});
  heading.scrollIntoView = scroll;
  fireEvent.click(screen.getByRole("button", { name: "文書の場所をAIへ渡す" }));
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(heading);
  result.unmount();
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

test("言語切替とネイティブの閉じる通知を処理する", () => {
  const close = mock(() => {});
  const view = render(<HelpDialog language="ja" onClose={close} />);
  view.rerender(<HelpDialog language="en" onClose={close} />);
  const dialog = screen.getByRole("dialog", { name: HELP.en.title });
  act(() => dialog.dispatchEvent(new Event("close")));
  expect(close).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("heading", { name: HELP.ja.title })).toBeNull();
});

test("ヘルプ内のCtrl+Fなどを背面文書のキーリスナーへ伝えない", () => {
  const listener = mock(() => {});
  window.addEventListener("keydown", listener);
  try {
    render(<HelpDialog language="ja" onClose={() => {}} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "閉じる" }), {
      key: "f",
      ctrlKey: true,
    });
    expect(listener).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("keydown", listener);
  }
});
