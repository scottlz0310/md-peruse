import { describe, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef } from "react";
import {
  FIND_ACTIVE_HIGHLIGHT_NAME,
  FIND_HIGHLIGHT_NAME,
  MAX_FIND_MATCHES,
} from "../state/find";
import { DocumentFind, type FindHighlights } from "./DocumentFind";

/** 登録されたハイライトを名前ごとに文字列で控える。 */
function recordingHighlights() {
  const registered = new Map<string, string[]>();
  const highlights: FindHighlights = {
    set: (name, ranges) =>
      registered.set(
        name,
        ranges.map((range) => range.toString()),
      ),
    delete: (name) => registered.delete(name),
  };
  return { registered, highlights };
}

function Harness({
  html,
  highlights,
}: {
  html: string;
  highlights: FindHighlights;
}) {
  const ref = useRef<HTMLElement>(null);
  return (
    <>
      <DocumentFind root={ref} highlights={highlights} />
      <article
        ref={ref}
        data-testid="body"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: テスト用の固定の本文。
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}

function pressCtrlF() {
  return fireEvent.keyDown(window, { key: "f", ctrlKey: true });
}

function search(query: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "文書内を検索" }), {
    target: { value: query },
  });
}

function count() {
  return screen.getByRole("status").textContent;
}

describe("DocumentFind", () => {
  test("Ctrl+Fで検索欄を開き、WebView2標準の検索バーを開かせない", () => {
    const { highlights } = recordingHighlights();
    render(<Harness html="<p>a</p>" highlights={highlights} />);
    expect(screen.queryByRole("textbox", { name: "文書内を検索" })).toBeNull();

    const notCanceled = pressCtrlF();

    expect(notCanceled).toBe(false);
    expect(
      document.activeElement ===
        screen.getByRole("textbox", { name: "文書内を検索" }),
    ).toBe(true);
  });

  test("閉じている間のF3も奪って検索欄を開く", () => {
    const { highlights } = recordingHighlights();
    render(<Harness html="<p>a</p>" highlights={highlights} />);

    const notCanceled = fireEvent.keyDown(window, { key: "F3" });

    expect(notCanceled).toBe(false);
    expect(screen.getByRole("textbox", { name: "文書内を検索" })).toBeTruthy();
  });

  test("一致をハイライトし、現在位置を別のハイライトにする", () => {
    const { registered, highlights } = recordingHighlights();
    render(<Harness html="<p>Foo foo</p><p>FOO</p>" highlights={highlights} />);
    pressCtrlF();

    search("foo");

    expect(count()).toBe("1 / 3");
    expect(registered.get(FIND_ACTIVE_HIGHLIGHT_NAME)).toEqual(["Foo"]);
    expect(registered.get(FIND_HIGHLIGHT_NAME)).toEqual(["foo", "FOO"]);
  });

  test("forced-colorsでは現在位置だけをハイライトする", () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: query === "(forced-colors: active)",
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    try {
      const { registered, highlights } = recordingHighlights();
      render(<Harness html="<p>a a a</p>" highlights={highlights} />);
      pressCtrlF();

      search("a");

      expect(count()).toBe("1 / 3");
      expect(registered.get(FIND_HIGHLIGHT_NAME)).toEqual([]);
      expect(registered.get(FIND_ACTIVE_HIGHLIGHT_NAME)).toEqual(["a"]);
      cleanup();
    } finally {
      if (saved) Object.defineProperty(globalThis, "matchMedia", saved);
    }
  });

  test.each([
    ["Enter", { key: "Enter" }, "2 / 3", "input"],
    [
      "Shift+Enter（先頭から末尾へ折り返す）",
      { key: "Enter", shiftKey: true },
      "3 / 3",
      "input",
    ],
    ["F3", { key: "F3" }, "2 / 3", "window"],
    ["Shift+F3", { key: "F3", shiftKey: true }, "3 / 3", "window"],
  ] as const)("%sで一致を移動する", (_, init, expected, target) => {
    const { highlights } = recordingHighlights();
    render(<Harness html="<p>a a a</p>" highlights={highlights} />);
    pressCtrlF();
    search("a");

    fireEvent.keyDown(
      target === "input"
        ? screen.getByRole("textbox", { name: "文書内を検索" })
        : window,
      init,
    );

    expect(count()).toBe(expected);
  });

  test.each([
    ["前の一致", "3 / 3"],
    ["次の一致", "2 / 3"],
  ])("「%s」ボタンで移動する", (name, expected) => {
    const { highlights } = recordingHighlights();
    render(<Harness html="<p>a a a</p>" highlights={highlights} />);
    pressCtrlF();
    search("a");

    fireEvent.click(screen.getByRole("button", { name }));

    expect(count()).toBe(expected);
  });

  test.each([
    ["一致しない", "<p>abc</p>", "z", "一致なし"],
    ["検索語が空", "<p>abc</p>", "", ""],
    [
      "上限で打ち切った",
      `<p>${"a".repeat(MAX_FIND_MATCHES + 1)}</p>`,
      "a",
      `1 / ${MAX_FIND_MATCHES}+`,
    ],
  ])("件数の表示: %s", (_, html, query, expected) => {
    const { highlights } = recordingHighlights();
    render(<Harness html={html} highlights={highlights} />);
    pressCtrlF();

    search(query);

    expect(count()).toBe(expected);
  });

  test.each([
    ["Esc", () => fireEvent.keyDown(window, { key: "Escape" })],
    [
      "閉じるボタン",
      () =>
        fireEvent.click(screen.getByRole("button", { name: "検索を閉じる" })),
    ],
  ])("%sで閉じるとハイライトを消し、フォーカスを戻す", (_, close) => {
    const { registered, highlights } = recordingHighlights();
    render(
      <>
        <button type="button">前のフォーカス</button>
        <Harness html="<p>a a</p>" highlights={highlights} />
      </>,
    );
    const previous = screen.getByRole("button", { name: "前のフォーカス" });
    previous.focus();
    pressCtrlF();
    search("a");

    close();

    expect(screen.queryByRole("textbox", { name: "文書内を検索" })).toBeNull();
    expect(registered.size).toBe(0);
    expect(document.activeElement === previous).toBe(true);
  });

  test("検索中に本文が入れ替わったら探し直し、現在位置を件数に収める", async () => {
    const { registered, highlights } = recordingHighlights();
    render(<Harness html="<p>a a a</p>" highlights={highlights} />);
    pressCtrlF();
    search("a");
    fireEvent.keyDown(window, { key: "F3", shiftKey: true });
    expect(count()).toBe("3 / 3");

    // コードハイライトの完了やMermaidの描画と同じく、描画後に本文のDOMが差し替わる。
    await act(async () => {
      screen.getByTestId("body").innerHTML =
        '<pre><code><span class="hljs-keyword">a</span> a</code></pre>';
    });

    await waitFor(() => expect(count()).toBe("2 / 2"));
    expect(registered.get(FIND_ACTIVE_HIGHLIGHT_NAME)).toEqual(["a"]);
    expect(registered.get(FIND_HIGHLIGHT_NAME)).toEqual(["a"]);
  });

  test("アンマウントでハイライトの登録を取り除く", () => {
    const { registered, highlights } = recordingHighlights();
    const { unmount } = render(
      <Harness html="<p>a</p>" highlights={highlights} />,
    );
    pressCtrlF();
    search("a");

    unmount();

    expect(registered.size).toBe(0);
  });
});
