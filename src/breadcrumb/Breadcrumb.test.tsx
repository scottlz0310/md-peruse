import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
