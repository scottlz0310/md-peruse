import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FakeResizeObserver } from "../../test/fake-resize-observer";
import { LanguageProvider } from "../i18n/LanguageContext";
import { ROOT_PATH } from "../state/file-tree";
import { Breadcrumb } from "./Breadcrumb";

function mount(path: string) {
  const selected: string[] = [];
  render(
    <Breadcrumb
      rootLabel="src\docs"
      path={path}
      onSelect={(folder) => selected.push(folder)}
    />,
  );
  return selected;
}

afterEach(cleanup);

describe("Breadcrumb", () => {
  test.each([
    ["docs/guide/a.md", ["src\\docs", "docs", "guide"], "a.md"],
    ["README.md", ["src\\docs"], "README.md"],
  ])("%s をワークスペース名から順に示す", (path, folders, current) => {
    mount(path);

    const nav = screen.getByRole("navigation", { name: "パンくずリスト" });
    expect(nav.querySelectorAll("li")).toHaveLength(folders.length + 1);
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(folders);
    // 最後のセグメントは表示中の文書であり、操作を持たない（10.1.1）。
    const last = nav.querySelector('[aria-current="page"]');
    expect(last?.textContent).toBe(current);
    expect(last?.closest("button")).toBeNull();
  });

  test.each([
    ["src\\docs", ROOT_PATH],
    ["docs", "docs"],
    ["guide", "docs/guide"],
  ])("%s を選ぶとそのフォルダーのパスを渡す", (name, folder) => {
    const selected = mount("docs/guide/a.md");

    fireEvent.click(screen.getByRole("button", { name }));

    expect(selected).toEqual([folder]);
  });

  test("区切りは読み上げない", () => {
    mount("docs/a.md");

    for (const separator of document.querySelectorAll(
      ".breadcrumb-separator",
    )) {
      expect(separator.getAttribute("aria-hidden")).toBe("true");
    }
    expect(screen.getByRole("navigation").textContent).toBe(
      "src\\docs›docs›a.md",
    );
  });
});

describe("Breadcrumb: 幅に収まらないときは末尾へスクロールする（10.1.1）", () => {
  const SCROLL_WIDTH = 1234;
  let written: number[];
  const original = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollLeft",
  );

  /** happy-domはレイアウトを持たないため、`scrollWidth` を固定し、`scrollLeft` への書き込みを記録する。 */
  beforeEach(() => {
    written = [];
    FakeResizeObserver.install();
    Object.defineProperty(Element.prototype, "scrollWidth", {
      configurable: true,
      get: () => SCROLL_WIDTH,
    });
    Object.defineProperty(Element.prototype, "scrollLeft", {
      configurable: true,
      get: () => 0,
      set(this: Element, value: number) {
        if (this.classList.contains("breadcrumb")) written.push(value);
      },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, "scrollWidth");
    if (original)
      Object.defineProperty(Element.prototype, "scrollLeft", original);
    FakeResizeObserver.uninstall();
  });

  const view = (path: string, rootLabel = "src\\docs") => (
    <Breadcrumb rootLabel={rootLabel} path={path} onSelect={() => {}} />
  );

  test("表示したとき、末尾までスクロールする", () => {
    render(view("docs/guide/a.md"));

    expect(written).toEqual([SCROLL_WIDTH]);
  });

  test.each([
    ["パスが変わったとき", 2, "docs/guide/b.md", "src\\docs"],
    ["ワークスペース名が変わったとき", 2, "docs/guide/a.md", "src\\other"],
    ["どちらも変わらない再描画では", 1, "docs/guide/a.md", "src\\docs"],
  ])("%s、スクロールは合計 %i 回", (_name, times, path, rootLabel) => {
    const { rerender } = render(view("docs/guide/a.md"));

    rerender(view(path, rootLabel));

    expect(written).toHaveLength(times);
  });

  test("幅が変わったとき、末尾までスクロールし直す", () => {
    render(view("docs/guide/a.md"));

    FakeResizeObserver.notify();

    expect(written).toEqual([SCROLL_WIDTH, SCROLL_WIDTH]);
  });
});

describe("Breadcrumb: UI言語（10.5）", () => {
  test.each([
    ["ja", "パンくずリスト"],
    ["en", "Breadcrumbs"],
  ] as const)("%s: ナビゲーションの名前", (language, name) => {
    render(
      <LanguageProvider language={language}>
        <Breadcrumb rootLabel="docs" path="a.md" onSelect={() => {}} />
      </LanguageProvider>,
    );

    expect(screen.getByRole("navigation", { name })).toBeTruthy();
  });
});
