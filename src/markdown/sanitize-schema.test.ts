import { describe, expect, test } from "bun:test";
import type { Element, Root } from "hast";
import { sanitize } from "hast-util-sanitize";
import { sanitizeSchema } from "./sanitize-schema";

function element(
  tagName: string,
  properties: Element["properties"] = {},
): Element {
  return { type: "element", tagName, properties, children: [] };
}

function sanitizeElement(node: Element): Element | undefined {
  const root: Root = { type: "root", children: [node] };
  const result = sanitize(root, sanitizeSchema) as Root;
  return result.children.find(
    (child): child is Element => child.type === "element",
  );
}

/** 表の構成要素は祖先に `table` を要求するため、包んでから検査する。 */
function sanitizeInTable(node: Element): Element | undefined {
  const table: Element = { ...element("table"), children: [node] };
  return sanitizeElement(table)?.children.find(
    (child): child is Element => child.type === "element",
  );
}

describe("許可する要素", () => {
  test.each([
    "h1",
    "h6",
    "p",
    "br",
    "hr",
    "strong",
    "em",
    "del",
    "code",
    "span",
    "sup",
    "a",
    "img",
    "ul",
    "ol",
    "li",
    "input",
    "blockquote",
    "pre",
    "table",
    "section",
    "math",
    "semantics",
    "annotation",
    "mrow",
    "mfrac",
    "msqrt",
    "msubsup",
    "mtable",
  ])("%s は残る", (tagName) => {
    expect(sanitizeElement(element(tagName))?.tagName).toBe(tagName);
  });

  test.each(["thead", "tbody", "tr", "th", "td"])(
    "%s は table の中で残る",
    (tagName) => {
      expect(sanitizeInTable(element(tagName))?.tagName).toBe(tagName);
    },
  );
});

describe("除去する要素", () => {
  test.each([
    // Raw HTMLはテキストとして出力するため本来到達しないが、
    // schemaが列挙外の要素を落とすことを固定する（8.1、8.2）。
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "form",
    "div",
    "details",
    "summary",
    "picture",
    "source",
    "svg",
    "foreignObject",
    // KaTeXが理論上生成しうるが、src属性を持つため許可しない。
    "mglyph",
  ])("%s は除去される", (tagName) => {
    expect(sanitizeElement(element(tagName))).toBeUndefined();
  });

  test.each(["thead", "tbody", "tr", "th", "td"])(
    "%s は table の外では除去される",
    (tagName) => {
      expect(sanitizeElement(element(tagName))).toBeUndefined();
    },
  );
});

describe("リンクのプロトコル", () => {
  test.each([
    ["https://example.com/", true],
    ["http://example.com/", true],
    ["./other.md", true],
    ["../parent/other.md#section", true],
    ["#anchor", true],
    ["javascript:alert(1)", false],
    ["data:text/html,<script>", false],
    ["file:///C:/Windows/System32", false],
    ["ms-settings:privacy", false],
    ["vbscript:msgbox(1)", false],
  ])("href=%s の保持は %s", (href, kept) => {
    const result = sanitizeElement(element("a", { href }));
    expect(result?.properties?.href).toBe(kept ? href : undefined);
  });
});

describe("画像のsrc", () => {
  test.each([
    ["http://mdperuse-img.localhost/abc123_-", true],
    ["http://mdperuse-img.localhost/", false],
    ["http://mdperuse-img.localhost/abc/../etc", false],
    ["https://example.com/remote.png", false],
    ["data:image/svg+xml;base64,PHN2Zz4=", false],
    ["./local.png", false],
    ["file:///C:/img.png", false],
  ])("src=%s の保持は %s", (src, kept) => {
    const result = sanitizeElement(element("img", { src }));
    expect(result?.properties?.src).toBe(kept ? src : undefined);
  });
});

describe("属性", () => {
  test("on* 属性は除去される", () => {
    const result = sanitizeElement(
      element("a", { onClick: "alert(1)", href: "#x" }),
    );
    expect(result?.properties?.onClick).toBeUndefined();
    expect(result?.properties?.href).toBe("#x");
  });

  test("style 属性は除去される", () => {
    const result = sanitizeElement(
      element("span", { style: "position:fixed" }),
    );
    expect(result?.properties?.style).toBeUndefined();
  });

  test("codeの言語クラスは残り、それ以外のクラスは取り除かれる", () => {
    expect(
      sanitizeElement(element("code", { className: ["language-rust"] }))
        ?.properties?.className,
    ).toEqual(["language-rust"]);
    expect(
      sanitizeElement(element("code", { className: ["arbitrary"] }))?.properties
        ?.className,
    ).toEqual([]);
  });

  test("inputは常にcheckboxかつ操作不可になる", () => {
    // `required` により、typeがcheckbox以外でもcheckboxへ揃えられ、disabledが付く（8.2）。
    expect(
      sanitizeElement(element("input", { type: "checkbox", disabled: true }))
        ?.properties,
    ).toEqual({
      type: "checkbox",
      disabled: true,
    });
    expect(
      sanitizeElement(element("input", { type: "text" }))?.properties,
    ).toEqual({
      type: "checkbox",
      disabled: true,
    });
  });

  test("表の桁揃えは既知の値だけ残る", () => {
    expect(
      sanitizeInTable(element("td", { align: "center" }))?.properties?.align,
    ).toBe("center");
    expect(
      sanitizeInTable(element("td", { align: "expression(1)" }))?.properties
        ?.align,
    ).toBeUndefined();
  });

  test("見出しのidにはclobberPrefixが付く", () => {
    // DOM clobbering対策として `user-content-` が前置される。
    // アンカー移動はこの前置を踏まえて解決する（design-decisions.md 8.2）。
    expect(
      sanitizeElement(element("h2", { id: "section" }))?.properties?.id,
    ).toBe("user-content-section");
  });
});
