import { describe, expect, test } from "bun:test";
import { MAX_FIND_MATCHES } from "../state/find";
import { collectFindRanges } from "./find-ranges";

function rootOf(html: string): Element {
  const root = document.createElement("article");
  root.innerHTML = html;
  return root;
}

describe("collectFindRanges", () => {
  test.each([
    ["段落の中", "<p>Hello world</p>", "world", ["world"]],
    [
      "大文字小文字を吸収する",
      "<p>Foo foo FOO</p>",
      "foo",
      ["Foo", "foo", "FOO"],
    ],
    ["インライン要素をまたぐ", "<p>Hello <b>wor</b>ld</p>", "world", ["world"]],
    [
      "コードハイライトのspanをまたぐ",
      '<pre><code><span class="hljs-keyword">const</span> x</code></pre>',
      "const x",
      ["const x"],
    ],
    ["段落の境目はまたがない", "<p>foo</p><p>bar</p>", "foobar", []],
    ["見出しと段落の境目はまたがない", "<h2>foo</h2>bar", "foobar", []],
    ["brの前後はまたがない", "<p>foo<br>bar</p>", "foobar", []],
    [
      "表のセルの境目はまたがない",
      "<table><tr><td>a</td><td>b</td></tr></table>",
      "ab",
      [],
    ],
    [
      "KaTeXの出力を対象にしない",
      '<p>x <span class="katex"><math><mi>x</mi></math><annotation>x</annotation></span></p>',
      "x",
      ["x"],
    ],
    [
      "MermaidのSVGを対象にしない",
      '<div class="mermaid-diagram"><svg><text>node</text></svg></div><p>node</p>',
      "node",
      ["node"],
    ],
    ["重なる一致は数えない", "<p>aaaa</p>", "aa", ["aa", "aa"]],
    ["空の検索語は何も返さない", "<p>abc</p>", "", []],
  ])("%s", (_, html, query, expected) => {
    const ranges = collectFindRanges(rootOf(html), query);
    expect(ranges.map((range) => range.toString())).toEqual(expected);
  });

  test("一致の範囲はテキストノード上の位置を指す", () => {
    const root = rootOf("<p>ab<em>cd</em>ef</p>");
    const ranges = collectFindRanges(root, "bcde");

    expect(ranges).toHaveLength(1);
    const [range] = ranges as [Range];
    expect(range.startContainer.textContent).toBe("ab");
    expect(range.startOffset).toBe(1);
    expect(range.endContainer.textContent).toBe("ef");
    expect(range.endOffset).toBe(1);
  });

  test("一致件数は上限で打ち切る（8.6）", () => {
    const root = rootOf(`<p>${"a".repeat(MAX_FIND_MATCHES + 5)}</p>`);

    expect(collectFindRanges(root, "a")).toHaveLength(MAX_FIND_MATCHES);
  });
});
