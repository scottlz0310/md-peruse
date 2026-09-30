import { describe, expect, test } from "bun:test";
import type { Element, Root } from "hast";
import {
  anchorElementId,
  footnoteElementId,
  HEADING_ID_PREFIX,
  rehypeHeadingIds,
} from "./heading-id";

describe("anchorElementId", () => {
  test.each([
    // 断片, 期待するID
    ["sec", "user-content-sec"],
    ["%E8%A6%8B%E5%87%BA%E3%81%97", "user-content-見出し"],
    ["getting-started", "user-content-getting-started"],
    // 利用者が前置を書いても、その文字列ごと前置の下へ入る。
    ["user-content-fn-1", "user-content-user-content-fn-1"],
  ])("%s は %s を指す", (fragment, expected) => {
    expect(anchorElementId(fragment)).toBe(expected);
  });

  test.each([
    // 空の断片, 復号できない断片
    ["", "遷移先がない"],
    ["%ZZ", "復号できない"],
    ["%E8%A6", "途中で切れている"],
  ])("%s は解決できない（%s）", (fragment) => {
    expect(anchorElementId(fragment)).toBeNull();
  });
});

describe("footnoteElementId", () => {
  test("前置済みのIDへは前置しない", () => {
    expect(footnoteElementId("user-content-fn-1")).toBe("user-content-fn-1");
    expect(footnoteElementId("user-content-fnref-1")).toBe(
      "user-content-fnref-1",
    );
  });

  test("復号できない断片は解決できない", () => {
    expect(footnoteElementId("%ZZ")).toBeNull();
  });
});

describe("rehypeHeadingIds", () => {
  const heading = (text: string, id?: string): Element => ({
    type: "element",
    tagName: "h2",
    properties: id === undefined ? {} : { id },
    children: [{ type: "text", value: text }],
  });
  const treeOf = (...headings: Element[]): Root => ({
    type: "root",
    children: headings,
  });
  const idsOf = (tree: Root) =>
    (tree.children as Element[]).map((node) => node.properties.id);

  test("同じ見出しの連番は、既存のIDと使用済みの連番を飛ばす", () => {
    const tree = treeOf(
      heading("a"),
      heading("a"),
      heading("a-1"),
      heading("a"),
      heading("x", "user-content-a-4"),
      heading("a"),
      heading("a"),
    );
    rehypeHeadingIds()(tree);

    expect(idsOf(tree)).toEqual([
      "user-content-a",
      "user-content-a-1",
      "user-content-a-1-1",
      "user-content-a-2",
      "user-content-a-4",
      "user-content-a-3",
      "user-content-a-5",
    ]);
  });

  test("連番の探索を数え直さない。数え直した結果と同じIDになる", () => {
    // 数え直す実装（毎回 `-1` から探す）と、衝突しやすい小さな語彙の列で比べる。
    const words = ["a", "b", "a-1", "a-2", "b-1", "a 1"];
    let seed = 12345;
    const random = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % limit;
    };
    const slugOf = (word: string) => word.replace(" ", "-");
    const reference = (texts: string[]): string[] => {
      const used = new Set<string>();
      return texts.map((text) => {
        const base = `${HEADING_ID_PREFIX}${slugOf(text)}`;
        let candidate = base;
        for (let counter = 1; used.has(candidate); counter += 1) {
          candidate = `${base}-${counter}`;
        }
        used.add(candidate);
        return candidate;
      });
    };

    for (let round = 0; round < 50; round++) {
      const texts = Array.from(
        { length: 5 + random(60) },
        () => words[random(words.length)] as string,
      );
      const tree = treeOf(...texts.map((text) => heading(text)));
      rehypeHeadingIds()(tree);
      expect(idsOf(tree)).toEqual(reference(texts));
    }
  });

  test("同じ見出しが2万個並んでも、時間が二乗にならない", () => {
    // 数え直す実装では2万個で約34秒かかった（実測）。
    const count = 20_000;
    const tree = treeOf(...Array.from({ length: count }, () => heading("a")));
    rehypeHeadingIds()(tree);

    const ids = idsOf(tree);
    expect(ids[0]).toBe("user-content-a");
    expect(ids[count - 1]).toBe(`user-content-a-${count - 1}`);
    expect(new Set(ids).size).toBe(count);
  });
});

describe("HEADING_ID_PREFIX", () => {
  test("脚注と同じ前置を使う", () => {
    // `mdast-util-to-hast` が脚注へ付ける前置と揃える（design-decisions.md 8.2）。
    // 衝突は前置ではなく、既存IDを占有済みとして登録することで避ける。
    expect(HEADING_ID_PREFIX).toBe("user-content-");
  });
});
