import createDOMPurify, { type WindowLike } from "dompurify";
import type { Element, Root } from "hast";
import { toString as textOf } from "hast-util-to-string";
import type { Mermaid, MermaidConfig } from "mermaid";
import { visit } from "unist-util-visit";
import { MERMAID_LIMITS } from "./limits";

/** Mermaidのテーマ。表示テーマと `forced-colors` から決める（8.4）。 */
export type MermaidTheme = "default" | "dark" | "neutral";

/** 本文中のMermaidの図。 */
export type MermaidTarget = {
  /** 図の定義。 */
  source: string;
  /** 文書内で何番目の図か。上限を超えた図を見分けるために使う。 */
  index: number;
};

/**
 * sanitize済みの本文で、Mermaidの図になる `pre > code.language-mermaid` を文書順に集め、
 * `pre` 要素をキーとして返す。hastは読むだけで変更しない（8.2）。
 */
export function selectMermaidDiagrams(tree: Root): Map<Element, MermaidTarget> {
  const selected = new Map<Element, MermaidTarget>();
  visit(tree, "element", (node: Element, _index, parent) => {
    if (node.tagName !== "code") return;
    if (parent?.type !== "element" || parent.tagName !== "pre") return;
    const className = node.properties.className;
    if (!Array.isArray(className) || !className.includes("language-mermaid")) {
      return;
    }
    selected.set(parent, { source: textOf(node), index: selected.size });
  });
  return selected;
}

/**
 * 図の定義（`%%{init}%%` やfront matterの `config`）から上書きさせない設定。
 *
 * Mermaidの既定の6項目に、HTMLラベルとテーマCSSを加える。HTMLラベルは `foreignObject` を
 * 生み、`themeCSS` は任意のCSSを `style` 要素へ流し込むため、文書側から有効にさせない
 * （実測: 加えないとどちらも図の定義から有効にできた）。
 */
const SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "htmlLabels",
  "flowchart",
  "themeCSS",
];

/** Mermaidへ渡す設定。テーマ以外は固定する（8.4）。 */
export function mermaidConfig(theme: MermaidTheme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    maxEdges: MERMAID_LIMITS.maxEdges,
    maxTextSize: MERMAID_LIMITS.perDiagramBytes,
    // 既定ではMermaidが構文エラーの図を文書の末尾へ描画する（実測）。理由は自前で示す。
    suppressErrorRendering: true,
    theme,
    secure: SECURE_KEYS,
  };
}

/**
 * `style` 属性から移してよいSVGの表示属性。
 *
 * Mermaid 12はSVGの要素へインラインの `style` 属性を出力する。CSPの
 * `style-src-attr 'none'`（5.5）では効かないため、SVGの表示属性として正当なものだけを
 * 属性へ移す。実測で使われていたのは下記のうち `fill`、`stroke`、`stroke-width`、
 * `stroke-dasharray`、`stroke-dashoffset`、`text-anchor`、`font-size`、`font-weight` である。
 */
const PRESENTATION_ATTRIBUTES = new Set([
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "text-anchor",
  "dominant-baseline",
  "font-size",
  "font-weight",
  "font-style",
  "opacity",
]);

/**
 * 表示属性へ移す値の書式。色、長さ、数値の列と、色の関数表記（`rgb()`、`hsl()` など）
 * だけを通す。`url(` を含む値（外部参照）や、引用符・セミコロンを含む値は移さない。
 * 関数表記を通すのは、`dark` テーマの円グラフの凡例が `hsl()` で色を持つためである（実測）。
 */
const PRESENTATION_VALUE =
  /^(?:[#a-zA-Z0-9.,%\s-]+|(?:rgba?|hsla?)\([0-9.,%\s/-]+\))$/;

/** svg要素の `max-width`（px）。Mermaidは図の本来の幅をここで伝える。 */
const MAX_WIDTH_PX = /^([0-9.]+)px$/;

/**
 * Mermaidが生成したSVGをsanitizeする関数を作る（8.4）。
 *
 * DOMPurifyの利用箇所はここだけとする。本文用のschemaとは別に、SVGのプロファイルから
 * `foreignObject` とリンク先を落とす。`style` 属性は表示属性へ移してから落とす。
 *
 * `window` を受け取るのは、テストでDOMPurifyが対応するDOM実装（jsdom）を渡すためである。
 * happy-domではDOMPurifyが要素名を取得できず、`svg` 要素ごと除去される（実測）。
 */
export function createMermaidSanitizer(
  root: WindowLike,
): (svg: string) => string {
  const purifier = createDOMPurify(root);
  purifier.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName !== "style") return;
    data.keepAttr = false;
    for (const declaration of data.attrValue.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (property === "max-width" && node.nodeName.toLowerCase() === "svg") {
        // 図を本来の幅より大きく引き伸ばさない。表示幅への収まりはCSSで行う。
        const width = MAX_WIDTH_PX.exec(value)?.[1];
        if (width !== undefined) node.setAttribute("width", width);
        continue;
      }
      if (
        PRESENTATION_ATTRIBUTES.has(property) &&
        PRESENTATION_VALUE.test(value)
      ) {
        node.setAttribute(property, value);
      }
    }
  });
  return (svg) =>
    purifier.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["foreignObject"],
      // `securityLevel: "strict"` では生成されないが、クリック先を持たせない。
      FORBID_ATTR: ["href", "xlink:href"],
    });
}

/** 描画を打ち切った理由。 */
export class MermaidRenderError extends Error {}

type MermaidApi = Pick<Mermaid, "initialize" | "render">;

type RendererOptions = {
  /** 製品ではMermaidの動的import。 */
  load: () => Promise<MermaidApi>;
  timeoutMs: number;
  concurrency: number;
  /** 生成されたSVGのsanitize。製品では `createMermaidSanitizer(window)`。 */
  sanitize: (svg: string) => string;
};

/**
 * 図を描画する関数を作る。
 *
 * 同時に描画する図の数を `concurrency` に抑え、超過分は順に待たせる（8.4）。
 * `timeoutMs` を過ぎた図は理由を示して打ち切る。Mermaidの描画そのものは止められない
 * ため、打ち切った描画が終わるまで枠は空けない。空けると、止まらない描画が積み重なる。
 */
export function createMermaidRenderer(options: RendererOptions) {
  let loading: Promise<MermaidApi> | null = null;
  let active = 0;
  const waiting: (() => void)[] = [];
  let nextId = 0;

  async function acquire(): Promise<void> {
    if (active < options.concurrency) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  }

  function release() {
    const next = waiting.shift();
    if (next === undefined) active -= 1;
    else next();
  }

  return async function renderMermaid(
    source: string,
    theme: MermaidTheme,
  ): Promise<string> {
    if (
      new TextEncoder().encode(source).length > MERMAID_LIMITS.perDiagramBytes
    ) {
      throw new MermaidRenderError("図が大きすぎるため描画していません。");
    }
    loading ??= options.load();
    const mermaid = await loading.catch((error: unknown) => {
      loading = null;
      throw new MermaidRenderError(
        `図の描画機能を読み込めませんでした（${messageOf(error)}）。`,
      );
    });

    await acquire();
    nextId += 1;
    // 生成されるSVGと `style` 要素のセレクタはこのIDを使う。文書内で重複させない。
    const id = `mermaid-diagram-${nextId}`;
    let rendering: Promise<{ svg: string }>;
    try {
      mermaid.initialize(mermaidConfig(theme));
      rendering = mermaid.render(id, source);
    } catch (error) {
      release();
      throw new MermaidRenderError(
        `図を描画できません（${messageOf(error)}）。`,
      );
    }
    rendering.then(release, release);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new MermaidRenderError(
              "図の描画に時間がかかりすぎたため中断しました。",
            ),
          ),
        options.timeoutMs,
      );
    });
    try {
      const { svg } = await Promise.race([
        rendering.catch((error: unknown) => {
          throw new MermaidRenderError(
            `図を描画できません（${messageOf(error)}）。`,
          );
        }),
        timeout,
      ]);
      return options.sanitize(svg);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** 製品で使う描画関数。 */
export const renderMermaid = createMermaidRenderer({
  load: async () => (await import("mermaid")).default,
  timeoutMs: MERMAID_LIMITS.renderTimeoutMs,
  concurrency: MERMAID_LIMITS.concurrentRenders,
  sanitize: createMermaidSanitizer(window),
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
