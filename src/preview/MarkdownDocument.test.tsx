import { afterEach, describe, expect, test } from "bun:test";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MarkdownDocument } from "./MarkdownDocument";

afterEach(() => {
  cleanup();
});

describe("MarkdownDocument", () => {
  test("本文を描画する", async () => {
    render(<MarkdownDocument text={"# 見出し\n\n本文\n"} />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
        "見出し",
      ),
    );
  });

  test.each([
    ["相対リンク", "[次](./next.md)"],
    ["アンカー", "[節](#section)"],
    ["外部リンク", "[外](https://example.com)"],
  ])("%sのクリックでWebViewを遷移させない", async (_, markdown) => {
    render(<MarkdownDocument text={markdown} />);
    const link = await waitFor(() => screen.getByRole("link"));

    // 左クリック、`Ctrl` + クリック（新しいウィンドウ）、中クリック（`auxclick`）。
    const events = [
      createEvent.click(link, { button: 0 }),
      createEvent.click(link, { button: 0, ctrlKey: true }),
      new MouseEvent("auxclick", {
        bubbles: true,
        cancelable: true,
        button: 1,
      }),
    ];
    for (const event of events) {
      fireEvent(link, event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  test("リンクの外のクリックは止めない", async () => {
    render(<MarkdownDocument text={"本文\n"} />);
    const paragraph = await waitFor(() => screen.getByText("本文"));

    const event = createEvent.click(paragraph);
    fireEvent(paragraph, event);
    expect(event.defaultPrevented).toBe(false);
  });

  test("本文を差し替えると新しい本文を表示し、古い描画で上書きしない", async () => {
    const { rerender } = render(<MarkdownDocument text={"# 古い\n"} />);
    // 最初の描画の完了を待たずに差し替える。
    rerender(<MarkdownDocument text={"# 新しい\n"} />);

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
