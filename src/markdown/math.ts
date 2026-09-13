import type { Element, ElementContent, Parents, Root } from "hast";
import { fromHtmlIsomorphic } from "hast-util-from-html-isomorphic";
import { toText } from "hast-util-to-text";
import type Katex from "katex";
import { SKIP, visitParents } from "unist-util-visit-parents";
import { KATEX_LIMITS, mathRenderCost, shouldRenderMath } from "./limits";

/** 数式を描画できなかった位置に置く要素のクラス。 */
export const MATH_ERROR_CLASS = "math-error";

/** 描画できなかった理由を示す要素のクラス。ソースと区別して表示する。 */
export const MATH_ERROR_REASON_CLASS = "math-error-reason";

/** KaTeXを読み込む関数。テストで読込の失敗を注入するために受け取る。 */
export type KatexLoader = () => Promise<typeof Katex>;

type Options = {
  /** 製品ではKaTeXの動的import。 */
  loadKatex?: KatexLoader;
};

const loadKatexModule: KatexLoader = async () =>
  (await import("katex")).default;

/** 数式の位置と表示形式。 */
type MathTarget = {
  /** 置き換える要素。` ```math ` のブロックでは `pre`。 */
  scope: Element;
  parent: Parents;
  displayMode: boolean;
};

/**
 * 数式をKaTeXでMathMLへ描画する `rehype` プラグイン（design-decisions.md 8.5）。
 *
 * `rehype-katex` を使わないのは、数式ごとの上限の判定と、構文エラーを自前の要素で
 * 示す口がないためである。対象の選び方（`language-math`、`math-display`、
 * `math-inline`）は `rehype-katex` と同じにしている。
 *
 * KaTeXは数式を含む文書でだけ読み込む。上限を超えた数式、構文エラーの数式、KaTeXを
 * 読み込めなかった場合は、その位置にソースと理由を示し、本文全体は壊さない（12章）。
 * sanitizeより前に置く（8.2）。
 */
export function rehypeMath(options: Options = {}) {
  const loadKatex = options.loadKatex ?? loadKatexModule;

  return async (tree: Root) => {
    const targets = collectMathTargets(tree);
    if (targets.length === 0) return;

    let katex: typeof Katex | null = null;
    let loadError: unknown = null;
    try {
      katex = await loadKatex();
    } catch (error) {
      loadError = error;
    }

    const encoder = new TextEncoder();
    let spent = 0;
    for (const { scope, parent, displayMode } of targets) {
      const source = toText(scope, { whitespace: "pre" });
      let replacement: ElementContent[];
      if (katex === null) {
        replacement = [
          mathError(
            source,
            `数式の描画機能を読み込めませんでした（${messageOf(loadError)}）。`,
          ),
        ];
      } else {
        const bytes = encoder.encode(source).length;
        if (shouldRenderMath(bytes, spent)) {
          spent += mathRenderCost(bytes);
          replacement = render(katex, source, displayMode);
        } else {
          replacement = [
            mathError(source, "数式が大きすぎるため描画していません。"),
          ];
        }
      }
      parent.children.splice(parent.children.indexOf(scope), 1, ...replacement);
    }
  };
}

function collectMathTargets(tree: Root): MathTarget[] {
  const targets: MathTarget[] = [];
  visitParents(tree, "element", (element: Element, ancestors) => {
    const classes = element.properties.className;
    if (!Array.isArray(classes)) return;
    const languageMath = classes.includes("language-math");
    const mathDisplay = classes.includes("math-display");
    if (!languageMath && !mathDisplay && !classes.includes("math-inline")) {
      return;
    }
    const parent = ancestors.at(-1);
    if (parent === undefined) return;
    // ` ```math ` のブロックは `pre` ごと置き換え、別行立てで表示する。
    if (
      languageMath &&
      element.tagName === "code" &&
      parent.type === "element" &&
      parent.tagName === "pre"
    ) {
      const grandparent = ancestors.at(-2);
      if (grandparent === undefined) return;
      targets.push({ scope: parent, parent: grandparent, displayMode: true });
      return SKIP;
    }
    targets.push({ scope: element, parent, displayMode: mathDisplay });
    return SKIP;
  });
  return targets;
}

function render(
  katex: typeof Katex,
  source: string,
  displayMode: boolean,
): ElementContent[] {
  let html: string;
  try {
    html = katex.renderToString(source, {
      displayMode,
      // `htmlAndMathml` は `style` 属性と `svg` を生成し、8.2の方針と両立しない。
      output: "mathml",
      throwOnError: true,
      trust: false,
      maxExpand: KATEX_LIMITS.maxExpand,
      maxSize: KATEX_LIMITS.maxSize,
    });
  } catch (error) {
    return [mathError(source, `数式を解釈できません（${messageOf(error)}）。`)];
  }
  return fromHtmlIsomorphic(html, { fragment: true })
    .children as ElementContent[];
}

function mathError(source: string, reason: string): Element {
  return {
    type: "element",
    tagName: "span",
    properties: { className: [MATH_ERROR_CLASS] },
    children: [
      {
        type: "element",
        tagName: "code",
        properties: {},
        children: [{ type: "text", value: source }],
      },
      {
        type: "element",
        tagName: "span",
        properties: { className: [MATH_ERROR_REASON_CLASS] },
        children: [{ type: "text", value: reason }],
      },
    ],
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
