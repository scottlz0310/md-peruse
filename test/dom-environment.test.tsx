// DOMテスト構成そのものの検証。happy-dom と Testing Library の組合せで
// state 更新を伴うインタラクションが扱えることを保証する。
import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      count: {count}
    </button>
  );
}

describe("DOMテスト構成", () => {
  test("クリックによるstate更新が描画へ反映される", () => {
    render(<Counter />);

    const button = screen.getByRole("button");
    expect(button.textContent).toBe("count: 0");

    fireEvent.click(button);

    expect(button.textContent).toBe("count: 1");
  });

  test("テスト間でDOMがcleanupされる", () => {
    expect(document.body.innerHTML).toBe("");
  });
});
