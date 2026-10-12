import { describe, expect, test } from "bun:test";
import {
  mergeUsage,
  parseUsageTable,
  serializeUsageTable,
} from "./usage-merged";

const HEADER =
  "SubscriptionName,DeviceType,PackageVersion,Market,Date,DailySessionCount,DailyActiveUsers";
const csv = (...rows: string[]) => [HEADER, ...rows, ""].join("\r\n");

// 全体の集計行（3 つとも All）と、個別の行が混在する（実際の CSV の形）。
const A = csv(
  "All,All,0.1.1.0,All,2026-10-06,4,1",
  "null,PC,0.1.1.0,JP,2026-10-06,4,1",
  "All,All,All,All,2026-10-06,4,1",
);

describe("parseUsageTable", () => {
  test("見出しと行を読む（BOM・CRLF・末尾の空行）", () => {
    const table = parseUsageTable(`﻿${A}`);
    expect(table.columns).toEqual(HEADER.split(","));
    expect(table.rows).toHaveLength(3);
    expect(table.rows[1]).toMatchObject({
      SubscriptionName: "null",
      DeviceType: "PC",
      Market: "JP",
      DailySessionCount: "4",
    });
  });

  test("引用符つきの値（カンマ・引用符・改行）を、書き出しと読み込みで往復できる", () => {
    const table = parseUsageTable(
      [
        "SubscriptionName,DeviceType,PackageVersion,Market,Date,Note",
        'All,All,"1,0",All,2026-10-06,"a ""b""\r\nc"',
        "",
      ].join("\r\n"),
    );
    expect(table.rows[0]).toMatchObject({
      PackageVersion: "1,0",
      Note: 'a "b"\r\nc',
    });
    expect(parseUsageTable(serializeUsageTable(table))).toEqual(table);
  });

  test.each([
    {
      name: "空の CSV",
      text: "",
      message: "日別の利用統計の CSV が空です",
    },
    {
      name: "キーの列が無い見出し（先頭がデータ行）",
      text: "All,All,0.1.1.0,All,2026-10-06,4777,1\r\n",
      message:
        "日別の利用統計の CSV に列がありません: Date, PackageVersion, Market, DeviceType, SubscriptionName",
    },
    {
      name: "キーの列が重複した見出し（行が潰れて、日付が失われる）",
      text: "Date,PackageVersion,Market,DeviceType,SubscriptionName,DailySessionCount,Date\r\n2026-10-06,All,All,All,All,4777,2026-10-08\r\n2026-10-07,All,All,All,All,4777,2026-10-08\r\n",
      message: "見出しに、重複した列名があります",
    },
    {
      name: "指標の列が重複した見出し",
      text: `${HEADER},DailySessionCount\r\nAll,All,0.1.1.0,All,2026-10-06,4777,1,5\r\n`,
      message: "見出しに、重複した列名があります",
    },
    {
      name: "行の列数が見出しと違う",
      text: `${HEADER}\r\nAll,All,0.1.1.0,All,2026-10-06,4777\r\n`,
      message: "2 行目の列数が、見出しと違います",
    },
  ])(
    "$name は、CSV の値を含めずに、原因が分かる例外にする",
    ({ text, message }) => {
      const error = (() => {
        try {
          parseUsageTable(text);
        } catch (e) {
          return e as Error;
        }
      })();
      expect(error?.message).toContain(message);
      expect(error?.message).not.toContain("4777");
    },
  );
});

describe("mergeUsage", () => {
  test("統合済みが無ければ、そのまま取り込む（行は、キー順に並べる）", () => {
    const result = mergeUsage(
      undefined,
      csv("All,All,All,All,2026-10-07,7,1", "All,All,All,All,2026-10-06,4,1"),
    );
    expect(result).toMatchObject({ added: 2, updated: 0, unchanged: 0 });
    expect(result.table.rows.map((r) => r.Date)).toEqual([
      "2026-10-06",
      "2026-10-07",
    ]);
  });

  test("同じキーは新しい側で置き換え（後勝ち）、新しい側に無い過去の行は残す", () => {
    const old = csv(
      "All,All,All,All,2026-10-05,3,1",
      "All,All,All,All,2026-10-06,4,1",
      "All,All,All,All,2026-10-07,7,1",
    );
    const incoming = csv(
      "All,All,All,All,2026-10-06,4,1",
      "All,All,All,All,2026-10-07,9,2",
      "All,All,All,All,2026-10-08,8,2",
    );

    const result = mergeUsage(old, incoming);

    expect(result).toMatchObject({ added: 1, updated: 1, unchanged: 1 });
    expect(result.table.rows.map((r) => [r.Date, r.DailySessionCount])).toEqual(
      [
        ["2026-10-05", "3"],
        ["2026-10-06", "4"],
        ["2026-10-07", "9"],
        ["2026-10-08", "8"],
      ],
    );
  });

  test("PackageVersion・Market・DeviceType・SubscriptionName が違う行は、別のキー", () => {
    const result = mergeUsage(
      csv("All,All,0.1.1.0,All,2026-10-06,4,1"),
      csv(
        "All,All,0.2.1.0,All,2026-10-06,5,1",
        "null,PC,0.1.1.0,JP,2026-10-06,4,1",
      ),
    );
    expect(result).toMatchObject({ added: 2, updated: 0, unchanged: 0 });
    expect(result.table.rows).toHaveLength(3);
  });

  test("同じ入力を 2 回取り込んでも、結果は変わらない（冪等）", () => {
    const once = mergeUsage(undefined, A);
    const twice = mergeUsage(once.csv, A);
    expect(twice.csv).toBe(once.csv);
    expect(twice).toMatchObject({ added: 0, updated: 0, unchanged: 3 });
  });

  test("新しい列が現れたら、既存の列の後ろへ足し、古い行の値は空にする", () => {
    const old = csv("All,All,All,All,2026-10-06,4,1");
    const incoming = [
      `${HEADER},NewMetric`,
      "All,All,All,All,2026-10-07,7,1,5",
      "",
    ].join("\r\n");

    const result = mergeUsage(old, incoming);

    expect(result.table.columns).toEqual([...HEADER.split(","), "NewMetric"]);
    expect(result.table.rows.map((r) => [r.Date, r.NewMetric])).toEqual([
      ["2026-10-06", ""],
      ["2026-10-07", "5"],
    ]);
  });

  test("統合済みが壊れていたら、値を含めずに例外にする（上書きしない）", () => {
    const error = (() => {
      try {
        mergeUsage("All,All,0.1.1.0,All,2026-10-06,4777,1\r\n", A);
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error?.message).toContain("日別の利用統計の CSV に列がありません");
    expect(error?.message).not.toContain("4777");
  });
});

describe("serializeUsageTable", () => {
  test("CRLF で書き、末尾に改行を付ける", () => {
    expect(serializeUsageTable(parseUsageTable(A))).toBe(A);
  });
});
