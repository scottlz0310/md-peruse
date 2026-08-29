import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  test("見出しと説明を描画する", () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "md-peruse",
    );
    expect(screen.getByText("閲覧専用Markdownビューワー")).toBeTruthy();
  });
});
