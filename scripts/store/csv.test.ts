import { describe, expect, test } from "bun:test";
import { cellValue, parseCsv, readListingTable } from "./csv";

describe("parseCsv", () => {
  test.each([
    [
      "単純な行",
      "a,b,c\n1,2,3",
      [
        ["a", "b", "c"],
        ["1", "2", "3"],
      ],
    ],
    [
      "CRLF の行",
      "a,b\r\n1,2\r\n",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    ["末尾に改行が無い", "a,b", [["a", "b"]]],
    ["引用符内のカンマ", 'a,"b,c",d', [["a", "b,c", "d"]]],
    ["引用符内の二重引用符", '"he said ""hi"""', [['he said "hi"']]],
    [
      "引用符内の CRLF は値に残る",
      'a,"line1\r\nline2",c\r\nx,y,z\r\n',
      [
        ["a", "line1\r\nline2", "c"],
        ["x", "y", "z"],
      ],
    ],
    [
      "空の値",
      "a,,c\n,,",
      [
        ["a", "", "c"],
        ["", "", ""],
      ],
    ],
  ])("%s", (_name, input, expected) => {
    expect(parseCsv(input)).toEqual(expected);
  });

  test("引用符が閉じていなければ例外にする", () => {
    expect(() => parseCsv('a,"b')).toThrow("引用符が閉じていません");
  });
});

const sample = [
  "\uFEFFField,ID,Type (種類),default,ja-jp,en-us",
  'Description,2,テキスト,,"一行目\r\n二行目",English',
  "Title,4,テキスト,,md-peruse,md-peruse",
  ",,,,,",
  "Feature1,700,テキスト,,機能,Feature",
].join("\r\n");

describe("readListingTable", () => {
  test("BOM を除き、言語の列と値を読む", () => {
    const table = readListingTable(sample);
    expect(table.columns).toEqual(["default", "ja-jp", "en-us"]);
    expect(cellValue(table, "Description", "ja-jp")).toBe("一行目\r\n二行目");
    expect(cellValue(table, "Description", "en-us")).toBe("English");
    expect(cellValue(table, "Title", "default")).toBe("");
  });

  test("Field が空の区切りの行は含めない", () => {
    const table = readListingTable(sample);
    expect([...table.fields.keys()]).toEqual([
      "Description",
      "Title",
      "Feature1",
    ]);
  });

  test("無い Field と無い列は空文字を返す", () => {
    const table = readListingTable(sample);
    expect(cellValue(table, "NoSuchField", "ja-jp")).toBe("");
    expect(cellValue(table, "Title", "fr-fr")).toBe("");
  });

  test.each([
    ["先頭が Field でない", "Name,ID,Type\r\n"],
    ["ID 列が無い", "Field,Value,Type\r\n"],
    ["Type 列が無い", "Field,ID,Kind,default\r\n"],
    ["空の入力", ""],
  ])("ヘッダーが想定と違えば例外にする: %s", (_name, input) => {
    expect(() => readListingTable(input)).toThrow("ヘッダーが想定と違います");
  });

  test("Field の重複は例外にする", () => {
    const text = "Field,ID,Type,default\r\nA,1,t,x\r\nA,2,t,y\r\n";
    expect(() => readListingTable(text)).toThrow("Field が重複しています: A");
  });
});
