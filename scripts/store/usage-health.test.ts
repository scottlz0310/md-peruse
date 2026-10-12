import { describe, expect, test } from "bun:test";
import {
  assessReport,
  describeEndTime,
  describeHealth,
  EXPIRY_WARNING_DAYS,
  healthNotices,
  STALE_AFTER_DAYS,
} from "./usage-health";

const NOW = new Date("2026-10-12T09:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) =>
  new Date(NOW.getTime() + offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z");

describe("assessReport: 古さ", () => {
  test.each([
    { name: "6 時間前", ageMs: 6 * 60 * 60 * 1000, ageDays: 0, stale: false },
    {
      name: "7 日前（週次の通常）",
      ageMs: 7 * DAY_MS,
      ageDays: 7,
      stale: false,
    },
    {
      name: "10 日ちょうど（超えていない）",
      ageMs: STALE_AFTER_DAYS * DAY_MS,
      ageDays: 10,
      stale: false,
    },
    {
      name: "10 日と 1 秒前（超えた）",
      ageMs: STALE_AFTER_DAYS * DAY_MS + 1000,
      ageDays: 10,
      stale: true,
    },
    { name: "12 日前", ageMs: 12 * DAY_MS, ageDays: 12, stale: true },
  ])("$name → 古い: $stale", ({ ageMs, ageDays, stale }) => {
    const health = assessReport({ reportGeneratedTime: iso(-ageMs) }, NOW);
    expect(health.ageDays).toBe(ageDays);
    expect(health.stale).toBe(stale);
  });
});

describe("assessReport: 終了予定", () => {
  const generated = iso(-DAY_MS);
  const remainingOf = (remainingMs: number) =>
    assessReport(
      { reportGeneratedTime: generated, endTime: iso(remainingMs) },
      NOW,
    );

  test.each([
    {
      name: "364 日（作ったばかりの週次 × 52 回）",
      remainingMs: 364 * DAY_MS,
      remainingDays: 364,
      expiringSoon: false,
    },
    {
      name: "60 日ちょうど（切っていない）",
      remainingMs: EXPIRY_WARNING_DAYS * DAY_MS,
      remainingDays: 60,
      expiringSoon: false,
    },
    {
      name: "60 日未満（1 秒足りない）",
      remainingMs: EXPIRY_WARNING_DAYS * DAY_MS - 1000,
      remainingDays: 59,
      expiringSoon: true,
    },
    {
      name: "2 日（検証用のレポート）",
      remainingMs: 2 * DAY_MS,
      remainingDays: 2,
      expiringSoon: true,
    },
    {
      name: "終了予定を過ぎている",
      remainingMs: -3 * DAY_MS,
      remainingDays: -3,
      expiringSoon: true,
    },
  ])("$name", ({ remainingMs, remainingDays, expiringSoon }) => {
    const health = remainingOf(remainingMs);
    expect(health.remainingDays).toBe(remainingDays);
    expect(health.expiringSoon).toBe(expiringSoon);
    expect(health.endTime).toBe(iso(remainingMs));
  });

  test.each([
    { name: "応答に無い", endTime: undefined },
    { name: "null", endTime: null },
    { name: "読めない形式", endTime: "いつか" },
  ])("終了予定が $name ときは、不明として、警告を出さない", ({ endTime }) => {
    const health = assessReport(
      { reportGeneratedTime: generated, endTime },
      NOW,
    );
    expect(health.endTime).toBeUndefined();
    expect(health.remainingDays).toBeUndefined();
    expect(health.expiringSoon).toBe(false);
    expect(describeEndTime(health)).toBe("不明（応答に無い）");
  });
});

describe("describeHealth", () => {
  const healthy = assessReport(
    { reportGeneratedTime: iso(-DAY_MS), endTime: iso(300 * DAY_MS) },
    NOW,
  );

  test("健全なら、警告も失敗も無い", () => {
    expect(describeHealth(healthy)).toEqual({
      warnings: [],
      failure: undefined,
    });
    expect(healthNotices(healthy)).toEqual([]);
  });

  test("終了前（60 日未満）は、警告だけで、失敗にしない。作り直しの手順を添える", () => {
    const health = assessReport(
      { reportGeneratedTime: iso(-DAY_MS), endTime: iso(30 * DAY_MS) },
      NOW,
    );
    const { warnings, failure } = describeHealth(health);
    expect(failure).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("まで、残り 30 日です");
    expect(warnings[0]).toContain("mode=usage-schedule");
    expect(warnings[0]).toContain("STORE_USAGE_REPORT_ID");
  });

  test("終了予定を過ぎていれば、その旨の警告（失敗にはしない）", () => {
    const health = assessReport(
      { reportGeneratedTime: iso(-DAY_MS), endTime: iso(-2 * DAY_MS) },
      NOW,
    );
    const { warnings, failure } = describeHealth(health);
    expect(failure).toBeUndefined();
    expect(warnings[0]).toContain("を過ぎています");
    expect(describeEndTime(health)).toContain("過ぎている");
  });

  test("古い（10 日超）ときは、失敗の理由を返す。状態の確認と作り直しの手順を添える", () => {
    const health = assessReport(
      { reportGeneratedTime: iso(-12 * DAY_MS), endTime: iso(300 * DAY_MS) },
      NOW,
    );
    const { warnings, failure } = describeHealth(health);
    expect(warnings).toEqual([]);
    expect(failure).toContain("12 日前です");
    expect(failure).toContain("mode=usage-status");
    expect(failure).toContain("mode=usage-schedule");
  });

  test("古く、かつ終了予定も過ぎているなら、失敗の理由と警告の両方を、失敗の理由を先に並べる", () => {
    const health = assessReport(
      { reportGeneratedTime: iso(-12 * DAY_MS), endTime: iso(-5 * DAY_MS) },
      NOW,
    );
    const notices = healthNotices(health);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain("12 日前です");
    expect(notices[1]).toContain("を過ぎています");
  });
});
