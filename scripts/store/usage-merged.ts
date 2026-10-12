// 日別の利用統計（`UsageDaily` の CSV）の統合。
//
// 繰り返しレポートの各実行は、直近 30 日分の CSV を返す。実行ごとの生スナップショットが正本で、
// 統合した CSV（`/usage-daily/merged.csv`）は、そこから作る写し（いつでも作り直せる）。
// 同じキー（Date × PackageVersion × Market × DeviceType × SubscriptionName）の行は、新しい側で
// 置き換える（後勝ち）。新しい側に無い過去の行は、そのまま残す。
//
// 例外の文には、CSV の値を入れない（公開のログ・artifact・Step Summary に出るため）。
// 足りない既知の列の名前と、行の番号だけを伝える。

import { parseCsv } from "./csv";

export const KEY_COLUMNS = [
  "Date",
  "PackageVersion",
  "Market",
  "DeviceType",
  "SubscriptionName",
] as const;

export type UsageRow = Record<string, string>;

export interface UsageTable {
  columns: string[];
  rows: UsageRow[];
}

/** 見出しに `KEY_COLUMNS` が揃っていなければ、足りない列の名前だけで例外にする。 */
export function parseUsageTable(text: string): UsageTable {
  const table = parseCsv(text.replace(/^﻿/, "")).filter((row) =>
    row.some((cell) => cell !== ""),
  );
  const columns = table[0];
  if (!columns) throw new Error("日別の利用統計の CSV が空です");
  const missing = KEY_COLUMNS.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `日別の利用統計の CSV に列がありません: ${missing.join(", ")}`,
    );
  }
  const rows = table.slice(1).map((cells, index) => {
    if (cells.length !== columns.length) {
      throw new Error(
        `日別の利用統計の CSV の ${index + 2} 行目の列数が、見出しと違います`,
      );
    }
    return Object.fromEntries(
      columns.map((name, i) => [name, cells[i] ?? ""]),
    ) as UsageRow;
  });
  return { columns, rows };
}

const keyOf = (row: UsageRow) =>
  KEY_COLUMNS.map((name) => row[name] ?? "").join("\u0000");

function compareRows(a: UsageRow, b: UsageRow): number {
  for (const name of KEY_COLUMNS) {
    const x = a[name] ?? "";
    const y = b[name] ?? "";
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

export function serializeUsageTable(table: UsageTable): string {
  const lines = [
    table.columns.map(quote).join(","),
    ...table.rows.map((row) =>
      table.columns.map((name) => quote(row[name] ?? "")).join(","),
    ),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export interface MergeResult {
  table: UsageTable;
  csv: string;
  added: number;
  updated: number;
  unchanged: number;
}

/**
 * `existing`（統合済みの CSV。まだ無ければ undefined）へ、`incoming`（最新のスナップショット）を取り込む。
 * 列は、既存の列に、新しく現れた列を後ろへ足す。新しい側に無い列の値は、空として扱う。
 */
export function mergeUsage(
  existing: string | undefined,
  incoming: string,
): MergeResult {
  const base =
    existing === undefined
      ? { columns: [], rows: [] }
      : parseUsageTable(existing);
  const next = parseUsageTable(incoming);
  const columns = [
    ...base.columns,
    ...next.columns.filter((name) => !base.columns.includes(name)),
  ];

  const byKey = new Map(base.rows.map((row) => [keyOf(row), row]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const row of next.rows) {
    const key = keyOf(row);
    const before = byKey.get(key);
    if (!before) {
      added += 1;
    } else if (
      columns.every((name) => (before[name] ?? "") === (row[name] ?? ""))
    ) {
      unchanged += 1;
    } else {
      updated += 1;
    }
    byKey.set(key, row);
  }

  // 新しい列が現れたとき、古い行にはその列が無い。空で埋めて、全ての行が全ての列を持つようにする。
  const table: UsageTable = {
    columns,
    rows: [...byKey.values()]
      .map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? ""])))
      .sort(compareRows),
  };
  return { table, csv: serializeUsageTable(table), added, updated, unchanged };
}
