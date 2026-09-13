import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MarkdownDocument, type NavigationTarget } from "./MarkdownDocument";

/** `scrollIntoView` の呼び出し先を記録する。happy-domは実際にはスクロールしない。 */
let scrolled: string[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
});

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

function mount(
  text: string,
  options: { path?: string; anchor?: string | null } = {},
) {
  const navigated: NavigationTarget[] = [];
  const props = {
    path: options.path ?? "docs/guide.md",
    anchor: options.anchor ?? null,
    onNavigate: (target: NavigationTarget) => navigated.push(target),
  };
  const view = render(<MarkdownDocument text={text} {...props} />);
  return {
    navigated,
    rerender: (next: string) =>
      view.rerender(<MarkdownDocument text={next} {...props} />),
  };
}

describe("MarkdownDocument", () => {
  test("本文を描画する", async () => {
    mount("# 見出し\n\n本文\n");

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "見出し",
      ),
    );
  });

  test("別の文書へのリンクは、文書の位置を基点に解決して知らせる（7.2）", async () => {
    const { navigated } = mount("[次](../next.md#setup)");
    const link = await waitFor(() => screen.getByRole("link"));

    const event = createEvent.click(link, { button: 0 });
    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(true);
    expect(navigated).toEqual([
      { kind: "document", path: "next.md", elementId: "user-content-setup" },
    ]);
  });

  test.each([
    [
      "外部リンク",
      "[外](https://example.com/)",
      { kind: "external", url: "https://example.com/" },
    ],
    [
      "ルート外",
      "[外](../../up.md)",
      { kind: "rejected", reason: "outsideRoot" },
    ],
    [
      "Markdown以外",
      "[画像](./a.png)",
      { kind: "rejected", reason: "notMarkdown" },
    ],
  ] as const)("%sは解決した結果を知らせる", async (_, markdown, expected) => {
    const { navigated } = mount(markdown);
    const link = await waitFor(() => screen.getByRole("link"));

    fireEvent.click(link, { button: 0 });

    expect(navigated).toEqual([expected]);
  });

  test("同一文書内のアンカーはその場で移動し、外へ知らせない", async () => {
    const { navigated } = mount("[節](#使い方)\n\n## 使い方\n");
    const link = await waitFor(() => screen.getByRole("link"));

    const event = createEvent.click(link, { button: 0 });
    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(true);
    expect(scrolled).toEqual(["user-content-使い方"]);
    expect(navigated).toEqual([]);
  });

  test("脚注の相互参照は前置済みのIDへ移動する", async () => {
    mount("本文[^1]\n\n[^1]: 注\n");
    const reference = await waitFor(() =>
      screen
        .getAllByRole("link")
        .find((link) => link.hasAttribute("data-footnote-ref")),
    );
    if (reference === undefined) throw new Error("脚注参照が描画されていない");

    fireEvent.click(reference, { button: 0 });

    expect(scrolled).toEqual(["user-content-fn-1"]);
  });

  test("hrefを落とされたリンクは何もしない", async () => {
    const { navigated } = mount("[危険](javascript:alert(1))");
    const link = await waitFor(() => screen.getByText("危険"));

    fireEvent.click(link, { button: 0 });

    expect(navigated).toEqual([]);
  });

  test.each([
    ["Ctrl + クリック", { button: 0, ctrlKey: true }],
    ["Shift + クリック", { button: 0, shiftKey: true }],
  ])("%sは遷移させず、同じタブでも開かない", async (_, init) => {
    const { navigated } = mount("[次](./next.md)");
    const link = await waitFor(() => screen.getByRole("link"));

    const event = createEvent.click(link, init);
    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(true);
    expect(navigated).toEqual([]);
  });

  test("中クリックは遷移させない", async () => {
    const { navigated } = mount("[次](./next.md)");
    const link = await waitFor(() => screen.getByRole("link"));

    const event = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    fireEvent(link, event);

    expect(event.defaultPrevented).toBe(true);
    expect(navigated).toEqual([]);
  });

  test("リンクの外のクリックは止めない", async () => {
    mount("本文\n");
    const paragraph = await waitFor(() => screen.getByText("本文"));

    const event = createEvent.click(paragraph);
    fireEvent(paragraph, event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("開いたときのアンカーへは描画の完了後に移動する", async () => {
    mount("## 導入\n\n## 設定\n", { anchor: "user-content-設定" });

    await waitFor(() => expect(scrolled).toEqual(["user-content-設定"]));
  });

  test("本文を差し替えると新しい本文を表示し、古い描画で上書きしない", async () => {
    const { rerender } = mount("# 古い\n");
    // 最初の描画の完了を待たずに差し替える。
    rerender("# 新しい\n");

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "新しい",
      ),
    );
    // 古い描画が後から完了しても上書きされない。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "新しい",
    );
  });
});
