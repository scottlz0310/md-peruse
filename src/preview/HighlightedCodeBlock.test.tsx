import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  HIGHLIGHT_ERROR_CLASS,
  HighlightedCodeBlock,
} from "./HighlightedCodeBlock";

afterEach(() => {
  cleanup();
});

describe("HighlightedCodeBlock", () => {
  test("文法の読込に失敗したら、プレーンなまま残してブロックの直後に原因を示す（12章）", async () => {
    const { container } = render(
      <HighlightedCodeBlock
        language="rust"
        className="language-rust"
        code="fn main() {}"
        highlight={() => Promise.reject(new Error("chunk load failed"))}
      />,
    );

    const error = await waitFor(() => {
      const element = container.querySelector(`.${HIGHLIGHT_ERROR_CLASS}`);
      expect(element).not.toBeNull();
      return element;
    });
    expect(error?.textContent).toContain("rust");
    expect(error?.previousElementSibling?.tagName).toBe("PRE");
    const code = container.querySelector("pre code");
    expect(code?.className).toBe("language-rust");
    expect(code?.textContent).toBe("fn main() {}");
    expect(code?.querySelector("span")).toBeNull();
  });

  test("読込を待つ間はプレーンなテキストを表示する", () => {
    const { container } = render(
      <HighlightedCodeBlock
        language="rust"
        className="language-rust"
        code="fn main() {}"
        highlight={() => new Promise(() => {})}
      />,
    );

    expect(container.querySelector("pre code")?.textContent).toBe(
      "fn main() {}",
    );
    expect(container.querySelector(`.${HIGHLIGHT_ERROR_CLASS}`)).toBeNull();
  });
});
