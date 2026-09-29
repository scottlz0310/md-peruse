import { describe, expect, test } from "bun:test";
import { MESSAGES } from "./messages";

const JAPANESE = /[ぁ-んァ-ヶ一-龠]/;
const ARGUMENT = "ARG";

/**
 * 文言の表を、キーの経路と文字列の組へ展開する。関数の文言は、引数へ `ARG` を渡して呼ぶ。
 * 展開後の文字列と、関数が引数を文言へ織り込むかを確かめるために使う。
 */
function flatten(value: unknown, path = ""): [string, string, boolean][] {
  if (typeof value === "string") return [[path, value, false]];
  if (typeof value === "function") {
    return [[path, (value as (a: string) => string)(ARGUMENT), true]];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => flatten(child, path === "" ? key : `${path}.${key}`),
  );
}

const ja = flatten(MESSAGES.ja);
const en = flatten(MESSAGES.en);

describe("UI文言（10.5）", () => {
  test("日本語と英語が同じキーを持つ", () => {
    expect(en.map(([key]) => key)).toEqual(ja.map(([key]) => key));
  });

  test.each([
    ["ja", ja],
    ["en", en],
  ] as const)(
    "%s: 空の文言がなく、関数は引数を文言へ織り込む",
    (_, entries) => {
      for (const [key, text, isFunction] of entries) {
        expect(text.length, key).toBeGreaterThan(0);
        if (isFunction) expect(text, key).toContain(ARGUMENT);
      }
    },
  );

  test("英語の文言に日本語の文字が残っていない", () => {
    const leftover = en.filter(([, text]) => JAPANESE.test(text));
    expect(leftover.map(([key]) => key)).toEqual([]);
  });

  test("英語の文言は、日本語の文言の写しではない", () => {
    const untranslated = en.filter(
      ([, text], index) => text === ja[index]?.[1],
    );
    expect(untranslated.map(([key]) => key)).toEqual([]);
  });
});
