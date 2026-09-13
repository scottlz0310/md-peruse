import { describe, expect, test } from "bun:test";
import type { Element, Root } from "hast";
import { resolveLanguage, selectHighlightable } from "./highlight";
import { HIGHLIGHT_LIMITS } from "./limits";

function code(className: string[], text: string): Element {
  return {
    type: "element",
    tagName: "code",
    properties: { className },
    children: [{ type: "text", value: text }],
  };
}

function pre(child: Element): Element {
  return { type: "element", tagName: "pre", properties: {}, children: [child] };
}

function root(...children: Element[]): Root {
  return { type: "root", children };
}

describe("resolveLanguage", () => {
  test.each([
    ["typescript", "typescript"],
    ["tsx", "typescript"],
    ["jsx", "javascript"],
    ["toml", "ini"],
    ["html", "xml"],
    ["c++", "cpp"],
    ["pwsh", "powershell"],
    ["brainfuck", null],
    ["math", null],
    // プロトタイプのプロパティ名を文法名として扱わない。
    ["constructor", null],
    ["__proto__", null],
  ])("%s → %s", (name, expected) => {
    expect(resolveLanguage(name)).toBe(expected);
  });
});

describe("selectHighlightable", () => {
  test("pre内のallowlistの言語だけを、preをキーにして選ぶ", () => {
    const ts = pre(code(["language-ts"], "let a;"));
    const unknown = pre(code(["language-brainfuck"], "+"));
    const plain = pre(code([], "x"));
    const math = pre(code(["language-math", "math-display"], "x"));
    const paragraph: Element = {
      type: "element",
      tagName: "p",
      properties: {},
      children: [code(["language-ts"], "let b;")],
    };

    const selected = selectHighlightable(
      root(ts, unknown, plain, math, paragraph),
    );

    expect(selected.size).toBe(1);
    expect(selected.get(ts)).toEqual({
      language: "typescript",
      className: "language-ts",
      code: "let a;",
    });
  });

  test("1ブロックの上限を超えたブロックは選ばず、後続のブロックは選ぶ", () => {
    const big = pre(
      code(["language-ts"], "a".repeat(HIGHLIGHT_LIMITS.perBlockBytes + 1)),
    );
    const small = pre(code(["language-ts"], "let a;"));

    const selected = selectHighlightable(root(big, small));

    expect(selected.has(big)).toBe(false);
    expect(selected.has(small)).toBe(true);
  });

  test("上限はUTF-8のバイト数で数える", () => {
    // 3バイトの文字で、文字数では上限内・バイト数では上限超過にする。
    const text = "あ".repeat(HIGHLIGHT_LIMITS.perBlockBytes / 2);

    const selected = selectHighlightable(
      root(pre(code(["language-ts"], text))),
    );

    expect(selected.size).toBe(0);
  });

  test("文書の予算を使い切った後のブロックは選ばない", () => {
    const fits =
      HIGHLIGHT_LIMITS.perDocumentBytes / HIGHLIGHT_LIMITS.perBlockBytes;
    const blocks = Array.from({ length: fits + 1 }, () =>
      pre(code(["language-ts"], "a".repeat(HIGHLIGHT_LIMITS.perBlockBytes))),
    );

    const selected = selectHighlightable(root(...blocks));

    expect(blocks.map((block) => selected.has(block))).toEqual([
      ...Array<boolean>(fits).fill(true),
      false,
    ]);
  });
});
