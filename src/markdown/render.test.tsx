import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ImageResource } from "../types/generated/ImageResource";
import type { IpcError } from "../types/generated/IpcError";
import { IMAGE_ERROR_CLASS, IMAGE_RESOURCE_ORIGIN } from "./images";
import { type ImageIssuer, renderMarkdown } from "./render";

/** 画像を含まない本文用。呼ばれたらテストの前提が崩れている。 */
const noImages: ImageIssuer = () => {
  throw new Error("画像のない本文でresource IDを発行しようとした");
};

/** 本文を描画し、描画先の要素を返す。 */
async function mount(
  markdown: string,
  issueImages: ImageIssuer = noImages,
): Promise<HTMLElement> {
  const { container } = render(await renderMarkdown(markdown, issueImages));
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

describe("renderMarkdown の画像（5.4、7.3）", () => {
  /** 参照ごとの応答を返し、受け取った参照を記録する。 */
  function issuer(respond: (reference: string) => ImageResource) {
    const received: string[][] = [];
    const issue: ImageIssuer = async (references) => {
      received.push(references);
      return references.map(respond);
    };
    return { issue, received };
  }

  const issued = (reference: string): ImageResource => ({
    status: "issued",
    reference,
    resourceId: `id-${reference.length}`,
  });

  test("発行したIDのURLへ書き換え、遅延読込の属性を付ける", async () => {
    const { issue, received } = issuer(issued);
    const container = await mount("![図](img/a.png)\n", issue);

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(`${IMAGE_RESOURCE_ORIGIN}/id-9`);
    expect(image?.getAttribute("alt")).toBe("図");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("decoding")).toBe("async");
    expect(received).toEqual([["img/a.png"]]);
  });

  test("参照は重複を除いて1回の要求にまとめる", async () => {
    const { issue, received } = issuer(issued);
    await mount("![a](a.png) ![b](b%20c.png) ![a2](a.png)\n", issue);

    // `remark-rehype` がパーセントエンコードした形のまま渡す。
    expect(received).toEqual([["a.png", "b%20c.png"]]);
  });

  test("発行できなかった画像の位置に原因を表示し、他の画像は表示する", async () => {
    const error: IpcError = {
      code: "fileNotFound",
      message: "ファイルが見つかりません。",
      detail: null,
    };
    const { issue } = issuer((reference) =>
      reference === "missing.png"
        ? { status: "failed", reference, error }
        : issued(reference),
    );
    const container = await mount(
      "前 ![無い](missing.png) 後\n\n![有る](ok.png)\n",
      issue,
    );

    const failure = container.querySelector(`.${IMAGE_ERROR_CLASS}`);
    expect(failure?.textContent).toBe(error.message);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.textContent).toContain("前");
    expect(container.textContent).toContain("後");
  });

  test("発行そのものが失敗したら、すべての画像の位置に原因を表示する", async () => {
    const error: IpcError = {
      code: "workspaceNotFound",
      message: "フォルダーが見つかりません。",
      detail: null,
    };
    const container = await mount("![a](a.png)\n\n![b](b.png)\n", () =>
      Promise.reject(error),
    );

    const failures = container.querySelectorAll(`.${IMAGE_ERROR_CLASS}`);
    expect([...failures].map((node) => node.textContent)).toEqual([
      error.message,
      error.message,
    ]);
    expect(container.querySelector("img")).toBeNull();
  });

  test.each([
    ["応答に含まれない参照", () => []],
    [
      "許可パターンに合わないID",
      (references: string[]) =>
        references.map(
          (reference): ImageResource => ({
            status: "issued",
            reference,
            resourceId: "../../etc",
          }),
        ),
    ],
  ])("%sのsrcはsanitizeが落とす", async (_, respond) => {
    const container = await mount("![a](a.png)\n", async (references) =>
      respond(references),
    );

    expect(container.querySelector("img")?.hasAttribute("src")).toBe(false);
  });
});
