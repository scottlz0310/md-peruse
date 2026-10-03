// Partner Center の掲載情報 CSV（エクスポート形式）を読む。
//
// 形式は `Field, ID, Type (種類)` に、言語の列（`default`、`ja-jp`、`en-us` など）が続く。
// UTF-8（BOM あり）で、行の区切りは CRLF、値に引用符で囲んだ改行を含む。
// `Field` が空の行は、項目の区切りのための空行で、値を持たない。

/** RFC 4180 の最小の実装。引用符内の改行と `""` を扱い、BOM は呼び出し側で除く。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }

  if (quoted) throw new Error("CSV の引用符が閉じていません");
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export interface ListingTable {
  /** ヘッダーの 4 列目以降（`default` と言語の列）。 */
  columns: string[];
  /** `Field` ごとの、列名 → 値。`Field` が空の行は含めない。 */
  fields: Map<string, Record<string, string>>;
}

export function readListingTable(text: string): ListingTable {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const header = rows[0];
  if (
    header?.[0] !== "Field" ||
    header[1] !== "ID" ||
    !header[2]?.startsWith("Type")
  ) {
    throw new Error(
      `掲載情報 CSV のヘッダーが想定と違います: ${JSON.stringify(header?.slice(0, 3))}`,
    );
  }

  const columns = header.slice(3);
  const fields = new Map<string, Record<string, string>>();
  for (const [index, row] of rows.slice(1).entries()) {
    const field = row[0] ?? "";
    if (field === "") continue;
    if (fields.has(field)) {
      throw new Error(
        `掲載情報 CSV の Field が重複しています: ${field}（${index + 2} 行目）`,
      );
    }
    const values: Record<string, string> = {};
    for (const [i, column] of columns.entries()) {
      values[column] = row[3 + i] ?? "";
    }
    fields.set(field, values);
  }
  return { columns, fields };
}

/** 値を返す。Field や列が無いときは空文字（未指定）にする。 */
export function cellValue(
  table: ListingTable,
  field: string,
  column: string,
): string {
  return table.fields.get(field)?.[column] ?? "";
}
