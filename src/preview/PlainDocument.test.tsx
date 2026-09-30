import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { collectFindRanges } from "./find-ranges";
import { PlainDocument } from "./PlainDocument";
import { PLAIN_CHUNK_CHARS } from "./plain-chunks";

function renderSource(text: string): HTMLPreElement {
  const { container } = render(<PlainDocument text={text} notice="案内" />);
  const source = container.querySelector<HTMLPreElement>("pre.plain-source");
  if (source === null) throw new Error("pre.plain-source が無い");
  return source;
}

describe("PlainDocument", () => {
  test("案内を role=note で本文の前に出す", () => {
    const { container } = render(
      <PlainDocument text="a" notice="書式なしで表示しています" />,
    );
    const notice = container.querySelector("p.plain-notice");
    expect(notice?.getAttribute("role")).toBe("note");
    expect(notice?.textContent).toBe("書式なしで表示しています");
    expect(notice?.nextElementSibling?.tagName).toBe("PRE");
  });

  test("短い本文は、1つのテキストノードで出す", () => {
    const source = renderSource("短い本文\n");
    expect(source.childNodes.length).toBe(1);
    expect(source.textContent).toBe("短い本文\n");
  });

  test("長い本文は、隣り合う複数のテキストノードに分けて出し、つなぐと元の本文になる", () => {
    const text = "word ".repeat(PLAIN_CHUNK_CHARS);
    const source = renderSource(text);
    expect(source.childNodes.length).toBeGreaterThan(1);
    for (const node of source.childNodes) {
      expect(node.nodeType).toBe(Node.TEXT_NODE);
    }
    expect(source.textContent).toBe(text);
  });

  test("分けた境目をまたぐ検索語も、1つの一致として見つける", () => {
    // 5,000文字の直後の最初の空白で切れるため、"alpha " と "beta" の間が境目になる。
    const text = `${"word ".repeat(1000)}alpha beta ${"word ".repeat(1500)}`;
    const source = renderSource(text);
    const first = source.childNodes[0] as Text;
    const second = source.childNodes[1] as Text;
    expect(first.data.endsWith("alpha ")).toBe(true);
    expect(second.data.startsWith("beta ")).toBe(true);

    const ranges = collectFindRanges(source, "alpha beta");

    expect(ranges.length).toBe(1);
    expect(ranges[0]?.startContainer).toBe(first);
    expect(ranges[0]?.endContainer).toBe(second);
    expect(ranges[0]?.toString()).toBe("alpha beta");
  });
});
