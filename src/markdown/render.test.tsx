import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { renderMarkdown } from "./render";

/** 本文を描画し、描画先の要素を返す。 */
async function mount(markdown: string): Promise<HTMLElement> {
  const { container } = render(await renderMarkdown(markdown));
  return container;
}

afterEach(() => {
  cleanup();
});

describe("renderMarkdown", () => {
  test("GFMの表、タスクリスト、取り消し線を要素として描画する", async () => {
    const container = await mount(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done\n\n~~old~~\n",
    );

    expect(container.querySelector("table td")?.textContent).toBe("1");
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox?.hasAttribute("checked")).toBe(true);
    expect(container.querySelector("del")?.textContent).toBe("old");
  });

  test("見出しへ前置つきのIDを付ける（8.2）", async () => {
    const container = await mount("# 概要\n");

    expect(container.querySelector("h1")?.id).toBe("user-content-概要");
  });

  test("Raw HTMLはソース文字列として表示し、要素にしない（8.1）", async () => {
    const container = await mount(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n',
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toBe(
      "<script>alert(1)</script>",
    );
  });

  test("YAML front matterは本文に出さない（8.1）", async () => {
    const container = await mount("---\ntitle: x\n---\n\n本文\n");

    expect(container.textContent).not.toContain("title");
    expect(container.querySelector("hr")).toBeNull();
    expect(container.textContent).toContain("本文");
  });

  test.each([
    "[link](javascript:alert(1))",
    "[link](data:text/html,<script>)",
    "[link](file:///C:/Windows)",
  ])("%s のhrefを落とす（7.2）", async (markdown) => {
    const container = await mount(markdown);

    expect(container.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  test("数式は描画を加えるまでコードとして表示する", async () => {
    const container = await mount("質量 $E=mc^2$ の式\n");

    const code = container.querySelector("code");
    expect(code?.textContent).toBe("E=mc^2");
    expect(code?.className).toContain("language-math");
  });

  test("style属性を出力しない（5.5、8.2）", async () => {
    const container = await mount(
      '| 左 | 右 |\n| :-- | --: |\n| a | b |\n\n<span style="color:red">x</span>\n',
    );

    expect(container.querySelector("[style]")).toBeNull();
    // 桁揃えは `style` へ変換せず `align` 属性で残す。
    const cells = container.querySelectorAll("td");
    expect(cells[0]?.getAttribute("align")).toBe("left");
    expect(cells[1]?.getAttribute("align")).toBe("right");
  });
});
