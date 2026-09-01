import { describe, expect, test } from "bun:test";
import {
  clampSidebarWidth,
  effectiveMaxSidebarWidth,
  MAX_SIDEBAR_RATIO,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  nextSidebarWidth,
  SIDEBAR_WIDTH_COARSE_STEP,
  SIDEBAR_WIDTH_STEP,
} from "./sidebar-width";

describe("effectiveMaxSidebarWidth", () => {
  const cases: ReadonlyArray<{
    name: string;
    windowWidth: number;
    expected: number;
  }> = [
    {
      name: "広いウィンドウでは絶対値の上限で止まる",
      windowWidth: 2560,
      expected: MAX_SIDEBAR_WIDTH,
    },
    {
      name: "上限のちょうど2倍のウィンドウでも絶対値の上限になる",
      windowWidth: MAX_SIDEBAR_WIDTH * 2,
      expected: MAX_SIDEBAR_WIDTH,
    },
    // 800 pxのウィンドウで600 pxを許すと本文は200 pxしか残らない。
    {
      name: "狭いウィンドウでは半分に制限される",
      windowWidth: 800,
      expected: 400,
    },
    {
      name: "割合が最小幅を下回るときは最小幅を返す",
      windowWidth: 300,
      expected: MIN_SIDEBAR_WIDTH,
    },
    {
      name: "幅0でも最小幅を返す",
      windowWidth: 0,
      expected: MIN_SIDEBAR_WIDTH,
    },
  ];

  for (const { name, windowWidth, expected } of cases) {
    test(name, () => {
      expect(effectiveMaxSidebarWidth(windowWidth)).toBe(expected);
    });
  }

  test("割合の上限を超えない", () => {
    for (const windowWidth of [500, 900, 1200, 1920]) {
      const max = effectiveMaxSidebarWidth(windowWidth);
      const withinRatio = max <= windowWidth * MAX_SIDEBAR_RATIO;
      expect(withinRatio || max === MIN_SIDEBAR_WIDTH).toBe(true);
    }
  });
});

describe("clampSidebarWidth", () => {
  const cases: ReadonlyArray<{
    name: string;
    saved: number;
    windowWidth: number;
    expected: number;
  }> = [
    {
      name: "範囲内の値はそのまま使う",
      saved: 320,
      windowWidth: 1920,
      expected: 320,
    },
    {
      name: "最小幅を下回る値は最小幅にする",
      saved: 120,
      windowWidth: 1920,
      expected: MIN_SIDEBAR_WIDTH,
    },
    {
      name: "絶対値の上限を超える値は上限にする",
      saved: 900,
      windowWidth: 1920,
      expected: MAX_SIDEBAR_WIDTH,
    },
    // ウィンドウを縮めたときは表示だけを詰める。設定は書き戻さないため、
    // 広げ直せば元の幅へ復帰する。
    {
      name: "狭いウィンドウでは割合の上限まで詰める",
      saved: 560,
      windowWidth: 800,
      expected: 400,
    },
    { name: "小数は丸める", saved: 320.6, windowWidth: 1920, expected: 321 },
    {
      name: "NaNは最小幅として扱う",
      saved: Number.NaN,
      windowWidth: 1920,
      expected: MIN_SIDEBAR_WIDTH,
    },
  ];

  for (const { name, saved, windowWidth, expected } of cases) {
    test(name, () => {
      expect(clampSidebarWidth(saved, windowWidth)).toBe(expected);
    });
  }
});

describe("nextSidebarWidth", () => {
  test("左右キーは刻みぶん動かす", () => {
    expect(nextSidebarWidth(320, 1, 1920)).toBe(320 + SIDEBAR_WIDTH_STEP);
    expect(nextSidebarWidth(320, -1, 1920)).toBe(320 - SIDEBAR_WIDTH_STEP);
  });

  test("Shift併用では大きく動かす", () => {
    expect(nextSidebarWidth(320, 1, 1920, true)).toBe(
      320 + SIDEBAR_WIDTH_COARSE_STEP,
    );
  });

  test("範囲の端では止まる", () => {
    expect(nextSidebarWidth(MIN_SIDEBAR_WIDTH, -1, 1920)).toBe(
      MIN_SIDEBAR_WIDTH,
    );
    expect(nextSidebarWidth(MAX_SIDEBAR_WIDTH, 1, 1920)).toBe(
      MAX_SIDEBAR_WIDTH,
    );
  });

  test("狭いウィンドウでは割合の上限で止まる", () => {
    expect(nextSidebarWidth(396, 1, 800)).toBe(400);
  });
});
