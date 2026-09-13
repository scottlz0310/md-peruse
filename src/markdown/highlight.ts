import type { Element, Root } from "hast";
import { toString as textOf } from "hast-util-to-string";
import type { LanguageFn } from "highlight.js";
import { createLowlight } from "lowlight";
import { visit } from "unist-util-visit";
import { highlightCost, shouldHighlight } from "./limits";

/**
 * コードブロックのシンタックスハイライト（design-decisions.md 8.3）。
 *
 * 言語はallowlistに載せたものだけを、使われたときに遅延登録する。自動判定は行わない。
 * 動的importを文字列リテラルで並べるのは、Viteが言語ごとにチャンクを分けられるように
 * するためである。
 */
const LOADERS: Record<string, () => Promise<{ default: LanguageFn }>> = {
  bash: () => import("highlight.js/lib/languages/bash"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  css: () => import("highlight.js/lib/languages/css"),
  diff: () => import("highlight.js/lib/languages/diff"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  go: () => import("highlight.js/lib/languages/go"),
  ini: () => import("highlight.js/lib/languages/ini"),
  java: () => import("highlight.js/lib/languages/java"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  makefile: () => import("highlight.js/lib/languages/makefile"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  plaintext: () => import("highlight.js/lib/languages/plaintext"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
  python: () => import("highlight.js/lib/languages/python"),
  rust: () => import("highlight.js/lib/languages/rust"),
  sql: () => import("highlight.js/lib/languages/sql"),
  swift: () => import("highlight.js/lib/languages/swift"),
  typescript: () => import("highlight.js/lib/languages/typescript"),
  xml: () => import("highlight.js/lib/languages/xml"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
};

/**
 * 別名から文法名への対応。highlight.js 11 の各文法が定義する別名のうち、fenceの言語名と
 * して使われうるものを載せる。allowlistの `tsx`、`jsx`、`toml`、`html` は単独の文法を
 * 持たず、ここで写像する（8.3）。
 */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  sh: "bash",
  zsh: "bash",
  pwsh: "powershell",
  ps: "powershell",
  ps1: "powershell",
  cs: "csharp",
  "c#": "csharp",
  cc: "cpp",
  "c++": "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  cxx: "cpp",
  yml: "yaml",
  toml: "ini",
  html: "xml",
  xhtml: "xml",
  svg: "xml",
  md: "markdown",
  mkd: "markdown",
  text: "plaintext",
  txt: "plaintext",
  docker: "dockerfile",
  mk: "makefile",
  make: "makefile",
};

const lowlight = createLowlight();
const loading = new Map<string, Promise<void>>();

/**
 * fenceの言語名を文法名へ解決する。allowlistにない言語は `null`。
 *
 * 大文字を含む言語名はsanitize schemaがclassごと落とすため、ここへは届かない。
 */
export function resolveLanguage(name: string): string | null {
  const canonical = ALIASES[name] ?? name;
  return Object.hasOwn(LOADERS, canonical) ? canonical : null;
}

/** ハイライトするコードブロック。 */
export type HighlightTarget = {
  /** allowlistで解決した文法名。 */
  language: string;
  /** `code` 要素のクラス。 */
  className: string;
  /** コードブロックの本文。 */
  code: string;
};

/**
 * sanitize済みの本文で、ハイライトしてよいコードブロックを決める（8.3）。
 *
 * `pre > code` のうち、allowlistの言語を持ち、1ブロックと1文書の上限に収まるものを
 * 文書順に選び、`pre` 要素をキーとして返す。hastは読むだけで変更しない（8.2）。
 */
export function selectHighlightable(tree: Root): Map<Element, HighlightTarget> {
  const selected = new Map<Element, HighlightTarget>();
  const encoder = new TextEncoder();
  let spent = 0;
  visit(tree, "element", (node: Element, _index, parent) => {
    if (node.tagName !== "code") return;
    if (parent?.type !== "element" || parent.tagName !== "pre") return;
    const classNames = classNamesOf(node);
    const language = languageOf(classNames);
    if (language === null) return;
    const code = textOf(node);
    const bytes = encoder.encode(code).length;
    if (!shouldHighlight(bytes, spent)) return;
    spent += highlightCost(bytes);
    selected.set(parent, { language, className: classNames.join(" "), code });
  });
  return selected;
}

function classNamesOf(element: Element): string[] {
  const className = element.properties.className;
  return Array.isArray(className)
    ? className.filter((c): c is string => typeof c === "string")
    : [];
}

function languageOf(classNames: string[]): string | null {
  const match = classNames.find((c) => c.startsWith("language-"));
  return match === undefined
    ? null
    : resolveLanguage(match.slice("language-".length));
}

/**
 * 解決済みの言語でハイライトしたhastを返す。文法は初回だけ読み込む。
 *
 * lowlightが返すのは `span` とclass名だけであり、入力はテキストに限る（8.2）。
 */
export async function highlightCode(
  language: string,
  code: string,
): Promise<Root> {
  let pending = loading.get(language);
  if (pending === undefined) {
    const loader = LOADERS[language];
    if (loader === undefined)
      throw new Error(`allowlistにない言語: ${language}`);
    pending = loader().then((module) => {
      lowlight.register(language, module.default);
    });
    loading.set(language, pending);
  }
  await pending;
  return lowlight.highlight(language, code);
}
