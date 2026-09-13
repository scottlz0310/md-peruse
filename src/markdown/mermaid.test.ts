import { describe, expect, mock, test } from "bun:test";
import type { Element, Root } from "hast";
import { JSDOM } from "jsdom";
import { MERMAID_LIMITS } from "./limits";
import {
  createMermaidRenderer,
  createMermaidSanitizer,
  MermaidRenderError,
  mermaidConfig,
  selectMermaidDiagrams,
} from "./mermaid";

function pre(className: string[], text: string): Element {
  return {
    type: "element",
    tagName: "pre",
    properties: {},
    children: [
      {
        type: "element",
        tagName: "code",
        properties: { className },
        children: [{ type: "text", value: text }],
      },
    ],
  };
}

// DOMPurifyが対応するDOM実装で検証する。happy-domでは `svg` 要素ごと除去される。
const jsdom = new JSDOM("<!DOCTYPE html>").window;
const sanitizeMermaidSvg = createMermaidSanitizer(
  jsdom as unknown as Parameters<typeof createMermaidSanitizer>[0],
);

function parse(svg: string): globalThis.Element {
  const host = jsdom.document.createElement("div");
  host.innerHTML = svg;
  const element = host.querySelector("svg");
  if (element === null) throw new Error("svgがない");
  return element as unknown as globalThis.Element;
}

describe("selectMermaidDiagrams", () => {
  test("mermaidのコードブロックだけを文書順に番号付きで選ぶ", () => {
    const first = pre(["language-mermaid"], "flowchart LR\n A-->B");
    const other = pre(["language-ts"], "let a;");
    const second = pre(["language-mermaid"], "pie");
    const tree: Root = { type: "root", children: [first, other, second] };

    const selected = selectMermaidDiagrams(tree);

    expect([...selected]).toEqual([
      [first, { source: "flowchart LR\n A-->B", index: 0 }],
      [second, { source: "pie", index: 1 }],
    ]);
  });
});

describe("mermaidConfig", () => {
  test("strictで、図の定義からHTMLラベルとテーマCSSを有効にさせない", () => {
    const config = mermaidConfig("dark");

    expect(config.securityLevel).toBe("strict");
    expect(config.htmlLabels).toBe(false);
    expect(config.flowchart?.htmlLabels).toBe(false);
    expect(config.maxEdges).toBe(MERMAID_LIMITS.maxEdges);
    expect(config.theme).toBe("dark");
    // 構文エラーの図をMermaidが文書の末尾へ描画しないようにする。
    expect(config.suppressErrorRendering).toBe(true);
    expect(config.secure).toEqual(
      expect.arrayContaining([
        "securityLevel",
        "htmlLabels",
        "flowchart",
        "themeCSS",
        "maxEdges",
      ]),
    );
  });
});

describe("sanitizeMermaidSvg", () => {
  test("style属性を表示属性へ移し、style属性そのものは残さない", () => {
    const svg = parse(
      sanitizeMermaidSvg(
        '<svg style="max-width: 450px;"><path style="stroke-width: 2; stroke-dasharray: 1, 0;"/><text style="text-anchor: middle; font-size: 16px;">a</text><rect style="fill:#ECECFF"/></svg>',
      ),
    );

    expect(svg.querySelector("[style]")).toBeNull();
    expect(svg.getAttribute("width")).toBe("450");
    const path = svg.querySelector("path");
    expect(path?.getAttribute("stroke-width")).toBe("2");
    expect(path?.getAttribute("stroke-dasharray")).toBe("1, 0");
    expect(svg.querySelector("text")?.getAttribute("text-anchor")).toBe(
      "middle",
    );
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#ECECFF");
  });

  test.each(["hsl(80, 100%, 56.2745098039%)", "rgba(0, 0, 0, 0.5)"])(
    "色の関数表記 %s は表示属性へ移す",
    (color) => {
      const svg = parse(
        sanitizeMermaidSvg(`<svg><rect style="fill: ${color}"/></svg>`),
      );

      expect(svg.querySelector("rect")?.getAttribute("fill")).toBe(color);
    },
  );

  test.each([
    ["外部参照", "fill: url(http://example.com/x)"],
    ["表示属性でないプロパティ", "background: red"],
    ["色でない関数表記", "fill: var(--x)"],
    ["関数表記に続く値", "fill: rgb(1,2,3) url(#x)"],
  ])("%sは移さない", (_, style) => {
    const svg = parse(
      sanitizeMermaidSvg(`<svg><rect style="${style}"/></svg>`),
    );
    const rect = svg.querySelector("rect");

    expect(rect?.getAttributeNames()).toEqual([]);
  });

  test("スクリプト、foreignObject、イベント属性、リンク先を落とす", () => {
    const svg = parse(
      sanitizeMermaidSvg(
        '<svg onload="alert(1)"><script>alert(1)</script><foreignObject><img src="x" onerror="alert(1)"></foreignObject><a href="javascript:alert(1)"><rect/></a><style>#id{fill:red}</style></svg>',
      ),
    );

    expect(svg.hasAttribute("onload")).toBe(false);
    expect(svg.querySelector("script, foreignObject, img")).toBeNull();
    expect(svg.querySelector("a")?.hasAttribute("href")).toBe(false);
    // テーマの `style` 要素は残す。CSPの `style-src-elem` が許可する（5.5）。
    expect(svg.querySelector("style")).not.toBeNull();
  });
});

type Render = (id: string, source: string) => Promise<{ svg: string }>;

function rendererWith(render: Render, overrides: { timeoutMs?: number } = {}) {
  const api = { initialize: mock(() => {}), render: mock(render) };
  const renderMermaid = createMermaidRenderer({
    load: async () => api as never,
    timeoutMs: overrides.timeoutMs ?? 1_000,
    concurrency: 2,
    // 描画結果がsanitizeを通ることだけを確かめる。sanitizeの中身は上のテストで固定する。
    sanitize: (svg) => svg.replace("<script>x</script>", ""),
  });
  return { api, renderMermaid };
}

describe("createMermaidRenderer", () => {
  test("図ごとに一意なIDで描画し、sanitizeしたSVGを返す", async () => {
    const { api, renderMermaid } = rendererWith(async (id) => ({
      svg: `<svg id="${id}"><script>x</script></svg>`,
    }));

    const [a, b] = await Promise.all([
      renderMermaid("flowchart LR\n A-->B", "default"),
      renderMermaid("pie", "dark"),
    ]);

    const ids = api.render.mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(2);
    expect(a).not.toContain("script");
    expect(b).toContain(`id="${ids[1]}"`);
    expect(api.initialize).toHaveBeenLastCalledWith(mermaidConfig("dark"));
  });

  test("同時に描画する図の数を上限に抑え、終わった順に次を始める", async () => {
    const pending: (() => void)[] = [];
    const { api, renderMermaid } = rendererWith(
      (id) =>
        new Promise((resolve) => {
          pending.push(() => resolve({ svg: `<svg id="${id}"></svg>` }));
        }),
    );

    const results = [1, 2, 3].map((n) => renderMermaid(`pie ${n}`, "default"));
    await Bun.sleep(0);
    expect(api.render).toHaveBeenCalledTimes(MERMAID_LIMITS.concurrentRenders);

    pending[0]?.();
    await Bun.sleep(0);
    expect(api.render).toHaveBeenCalledTimes(3);

    for (const resolve of pending) resolve();
    expect(await Promise.all(results)).toHaveLength(3);
  });

  test("時間内に終わらない描画は理由を示して打ち切る", async () => {
    const { renderMermaid } = rendererWith(() => new Promise(() => {}), {
      timeoutMs: 10,
    });

    await expect(renderMermaid("pie", "default")).rejects.toThrow(
      "時間がかかりすぎた",
    );
  });

  test("構文エラーは理由を示す", async () => {
    const { renderMermaid } = rendererWith(async () => {
      throw new Error("Parse error on line 2");
    });

    const error = await renderMermaid("flowchart LR\n A -->", "default").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MermaidRenderError);
    expect((error as Error).message).toContain("Parse error on line 2");
  });

  test("入力サイズの上限を超えた図は読み込みも描画もしない", async () => {
    const load = mock(async () => {
      throw new Error("呼ばれない");
    });
    const renderMermaid = createMermaidRenderer({
      load,
      timeoutMs: 1_000,
      concurrency: 2,
      sanitize: (svg) => svg,
    });

    await expect(
      renderMermaid("x".repeat(MERMAID_LIMITS.perDiagramBytes + 1), "default"),
    ).rejects.toThrow("大きすぎる");
    expect(load).not.toHaveBeenCalled();
  });

  test("Mermaidを読み込めなければ理由を示し、次の描画で読み込み直す", async () => {
    let attempts = 0;
    const renderMermaid = createMermaidRenderer({
      load: async () => {
        attempts += 1;
        throw new Error("chunk load failed");
      },
      timeoutMs: 1_000,
      concurrency: 2,
      sanitize: (svg) => svg,
    });

    await expect(renderMermaid("pie", "default")).rejects.toThrow(
      "chunk load failed",
    );
    await expect(renderMermaid("pie", "default")).rejects.toThrow(
      "読み込めませんでした",
    );
    expect(attempts).toBe(2);
  });
});
