import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { SidebarLayout } from "./SidebarLayout";

const originalInnerWidth = window.innerWidth;

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

function mount(savedWidth: number, sidebarVisible = true) {
  const committed: number[] = [];
  render(
    <SidebarLayout
      savedWidth={savedWidth}
      sidebarVisible={sidebarVisible}
      onWidthCommit={(width) => committed.push(width)}
      sidebar={<p>ツリー</p>}
    >
      <p>本文</p>
    </SidebarLayout>,
  );
  return committed;
}

function separator() {
  return screen.getByRole("separator");
}

beforeEach(() => setWindowWidth(1200));

afterEach(() => {
  cleanup();
  setWindowWidth(originalInnerWidth);
});

describe("SidebarLayout", () => {
  test("幅と範囲をARIAで伝え、CSSカスタムプロパティで反映する", () => {
    mount(280);

    expect(separator().getAttribute("aria-valuenow")).toBe("280");
    expect(separator().getAttribute("aria-valuemin")).toBe("200");
    // `min(600, 1200 × 50 %)`
    expect(separator().getAttribute("aria-valuemax")).toBe("600");
    expect(document.querySelector("style")?.textContent).toContain(
      "--sidebar-width: 280px",
    );
  });

  test.each([
    ["ArrowRight", false, 296],
    ["ArrowLeft", false, 264],
    ["ArrowRight", true, 344],
    ["ArrowLeft", true, 216],
    ["Home", false, 200],
    ["End", false, 600],
  ])("%s（Shift: %s）で幅を %d にして保存する", (key, shiftKey, expected) => {
    const committed = mount(280);

    fireEvent.keyDown(separator(), { key, shiftKey });

    expect(separator().getAttribute("aria-valuenow")).toBe(String(expected));
    expect(committed).toEqual([expected]);
  });

  test("範囲の外へは動かない", () => {
    const committed = mount(200);

    fireEvent.keyDown(separator(), { key: "ArrowLeft", shiftKey: true });

    expect(committed).toEqual([200]);
  });

  test("ほかのキーは幅を変えず、既定動作も止めない", () => {
    const committed = mount(280);

    const allowed = fireEvent.keyDown(separator(), { key: "Tab" });

    expect(allowed).toBe(true);
    expect(committed).toEqual([]);
  });

  test("ウィンドウを縮めると表示だけを詰め、広げ直すと保存値へ戻す（10.2）", () => {
    const committed = mount(500);

    act(() => {
      setWindowWidth(800);
      window.dispatchEvent(new Event("resize"));
    });
    expect(separator().getAttribute("aria-valuenow")).toBe("400");
    expect(separator().getAttribute("aria-valuemax")).toBe("400");

    act(() => {
      setWindowWidth(1200);
      window.dispatchEvent(new Event("resize"));
    });
    expect(separator().getAttribute("aria-valuenow")).toBe("500");
    expect(committed).toEqual([]);
  });

  test("ドラッグ中は表示だけを変え、離したときに保存する", () => {
    const committed = mount(280);
    const target = separator();
    // happy-domはポインターキャプチャを持たない。
    target.setPointerCapture = () => {};
    target.releasePointerCapture = () => {};

    fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 280 });
    // 掴んだ境界へフォーカスを移し、続けてキーで調整できるようにする。
    expect(document.activeElement).toBe(target);
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 350 });
    expect(target.getAttribute("aria-valuenow")).toBe("350");
    expect(committed).toEqual([]);

    // 範囲の外まで引いても上限で止める。
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 900 });
    expect(committed).toEqual([600]);
  });

  test("ボタンを押していない移動では幅を変えない", () => {
    const committed = mount(280);

    fireEvent.pointerMove(separator(), { pointerId: 1, clientX: 400 });
    fireEvent.pointerUp(separator(), { pointerId: 1, clientX: 400 });

    expect(separator().getAttribute("aria-valuenow")).toBe("280");
    expect(committed).toEqual([]);
  });

  test("サイドバーを表示しない設定では本文だけを置く", () => {
    mount(280, false);

    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryByText("ツリー")).toBeNull();
    expect(screen.getByText("本文")).toBeTruthy();
  });
});
