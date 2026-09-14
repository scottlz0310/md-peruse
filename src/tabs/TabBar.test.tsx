import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  activateTab,
  EMPTY_TAB_SET,
  openTab,
  type TabSet,
} from "../state/tab-set";
import { TabBar } from "./TabBar";

/** a.md（固定）、b.md（固定）、c.md（プレビュー）。b.md がアクティブ。 */
function sampleSet(): TabSet {
  let set = EMPTY_TAB_SET;
  for (const [index, [path, preview]] of (
    [
      ["docs/a.md", false],
      ["b.md", false],
      ["c.md", true],
    ] as const
  ).entries()) {
    set = openTab(set, {
      path,
      preview,
      now: index,
      fresh: { tabId: `t${index}`, scopeId: "s" },
    }).set;
  }
  return activateTab(set, "t1", 10);
}

function mount(set = sampleSet()) {
  const calls = {
    activated: [] as string[],
    closed: [] as string[],
    pinned: [] as string[],
  };
  render(
    <TabBar
      set={set}
      onActivate={(id) => calls.activated.push(id)}
      onClose={(id) => calls.closed.push(id)}
      onPin={(id) => calls.pinned.push(id)}
    />,
  );
  return calls;
}

const tab = (name: string) =>
  screen.getByRole("tab", { name: new RegExp(`^${name}`) });

afterEach(cleanup);

describe("TabBar", () => {
  test("タブの名前、選択、プレビューの区別、フォーカスを持つタブを示す", () => {
    mount();

    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(tab("a.md").getAttribute("title")).toBe("docs/a.md");
    expect(tab("b.md").getAttribute("aria-selected")).toBe("true");
    expect(tab("a.md").getAttribute("aria-selected")).toBe("false");
    expect(tab("c.md").classList.contains("tab-preview")).toBe(true);
    expect(tab("b.md").classList.contains("tab-preview")).toBe(false);
    expect(
      screen.getAllByRole("tab").filter((element) => element.tabIndex === 0),
    ).toEqual([tab("b.md")]);
  });

  test.each([
    ["ArrowRight", "t2"],
    ["ArrowLeft", "t0"],
    ["Home", "t0"],
    ["End", "t2"],
  ])("%s でアクティブにするタブを移す", (key, expected) => {
    const calls = mount();
    fireEvent.keyDown(tab("b.md"), { key });
    expect(calls.activated).toEqual([expected]);
  });

  test("端では反対側へ回る", () => {
    const calls = mount();
    fireEvent.keyDown(tab("c.md"), { key: "ArrowRight" });
    fireEvent.keyDown(tab("a.md"), { key: "ArrowLeft" });
    expect(calls.activated).toEqual(["t0", "t2"]);
  });

  test("クリックでアクティブに、ダブルクリックで固定、閉じるボタンと中クリックで閉じる", () => {
    const calls = mount();

    fireEvent.click(tab("a.md"));
    fireEvent.doubleClick(tab("c.md"));
    fireEvent.click(screen.getByRole("button", { name: "b.md を閉じる" }));
    fireEvent(
      tab("c.md"),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );

    expect(calls.activated).toEqual(["t0"]);
    expect(calls.pinned).toEqual(["t2"]);
    // 閉じるボタンのクリックはタブのアクティブ化へ伝わらない。
    expect(calls.closed).toEqual(["t1", "t2"]);
  });
});
