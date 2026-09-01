import { describe, expect, test } from "bun:test";
import {
  decreaseFontScale,
  FONT_SCALE_STEPS,
  type FontScalePercent,
  increaseFontScale,
  normalizeFontScale,
} from "./font-scale";

/** リテラル型のタプルではなく数値の配列として扱う。 */
const steps = (): number[] => [...FONT_SCALE_STEPS];

/** 隣り合う段階の差。 */
const intervals = (): number[] => {
  const values = steps();
  return values.slice(1).map((step, index) => step - (values[index] ?? step));
};

describe("FONT_SCALE_STEPS", () => {
  test("小さい順に並んでいる", () => {
    const sorted = steps().sort((a, b) => a - b);
    expect(steps()).toEqual(sorted);
  });

  test("重複がない", () => {
    expect(new Set(FONT_SCALE_STEPS).size).toBe(FONT_SCALE_STEPS.length);
  });

  // 既定値の正本は `src-tauri/src/settings.rs` の `DEFAULT_FONT_SCALE_PERCENT`。
  // 段階に含まれないと、既定値のまま拡大しても丸めで別の値へ飛ぶ。
  test("既定値の100を含む", () => {
    expect(steps()).toContain(100);
  });

  test("大きい側ほど刻みが粗い", () => {
    const gaps = intervals();
    for (let index = 1; index < gaps.length; index += 1) {
      expect(gaps[index]).toBeGreaterThanOrEqual(gaps[index - 1] ?? 0);
    }
  });
});

describe("normalizeFontScale", () => {
  const cases: ReadonlyArray<{
    name: string;
    input: number;
    expected: FontScalePercent;
  }> = [
    { name: "段階の値はそのまま返す", input: 125, expected: 125 },
    { name: "近い段階へ丸める", input: 137, expected: 125 },
    { name: "近い段階へ丸める（上方向）", input: 141, expected: 150 },
    // 等距離のときに大きいほうへ倒すと、意図せず読みにくい側へ動く場合がある。
    { name: "等距離のときは小さいほうを選ぶ", input: 105, expected: 100 },
    { name: "範囲より小さい値は最小段階にする", input: 10, expected: 80 },
    { name: "範囲より大きい値は最大段階にする", input: 400, expected: 200 },
    { name: "NaNは既定値にする", input: Number.NaN, expected: 100 },
  ];

  for (const { name, input, expected } of cases) {
    test(name, () => {
      expect(normalizeFontScale(input)).toBe(expected);
    });
  }
});

describe("increaseFontScale / decreaseFontScale", () => {
  test("1段階ずつ動く", () => {
    expect(increaseFontScale(100)).toBe(110);
    expect(decreaseFontScale(100)).toBe(90);
  });

  test("端では止まる", () => {
    expect(increaseFontScale(200)).toBe(200);
    expect(decreaseFontScale(80)).toBe(80);
  });

  test("段階外の値からでも動く", () => {
    expect(increaseFontScale(137)).toBe(150);
    expect(decreaseFontScale(137)).toBe(110);
  });

  test("端から端までの操作回数は段階数から1を引いた数である", () => {
    let percent: number = FONT_SCALE_STEPS[0];
    let presses = 0;
    while (percent !== FONT_SCALE_STEPS[FONT_SCALE_STEPS.length - 1]) {
      percent = increaseFontScale(percent);
      presses += 1;
    }
    expect(presses).toBe(FONT_SCALE_STEPS.length - 1);
  });
});
