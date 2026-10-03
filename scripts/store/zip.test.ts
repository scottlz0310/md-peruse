import { describe, expect, test } from "bun:test";
import { crc32, createZip } from "./zip";

const bytes = (text: string) => new TextEncoder().encode(text);

interface ReadEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  utf8: boolean;
}

/** 作った ZIP を、セントラル ディレクトリから独立に読み戻す（実装とは別の経路で検証する）。 */
function readZip(zip: Uint8Array): ReadEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const entries: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(
      zip.slice(cursor + 46, cursor + 46 + nameLength),
    );
    expect(method).toBe(0);

    expect(view.getUint32(localOffset, true)).toBe(0x04034b50);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const start = localOffset + 30 + localNameLength;
    entries.push({
      name,
      data: zip.slice(start, start + size),
      crc,
      utf8: (flags & 0x0800) !== 0,
    });
    cursor += 46 + nameLength;
  }
  return entries;
}

describe("crc32", () => {
  test.each([
    ["", 0x00000000],
    ["123456789", 0xcbf43926],
    ["The quick brown fox jumps over the lazy dog", 0x414fa339],
  ])("%p", (input, expected) => {
    expect(crc32(bytes(input))).toBe(expected);
  });
});

describe("createZip", () => {
  test("複数のファイルを格納し、読み戻して一致する", () => {
    const entries = [
      { name: "images/ja-jp/01-a.png", data: bytes("PNG-A") },
      {
        name: "md-peruse_0.1.1.0_x64.msixupload",
        data: new Uint8Array([0, 1, 2, 255]),
      },
      { name: "empty.bin", data: new Uint8Array(0) },
    ];
    const read = readZip(createZip(entries));
    expect(read.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (const [i, entry] of entries.entries()) {
      expect(read[i]?.data).toEqual(entry.data);
      expect(read[i]?.crc).toBe(crc32(entry.data));
    }
  });

  test("日本語のファイル名は UTF-8 の印をつけて格納する", () => {
    const read = readZip(
      createZip([{ name: "画像/北極星.png", data: bytes("x") }]),
    );
    expect(read[0]?.name).toBe("画像/北極星.png");
    expect(read[0]?.utf8).toBe(true);
  });

  test("同じ入力から同じバイト列ができる", () => {
    const entries = [{ name: "a.png", data: bytes("same") }];
    expect(createZip(entries)).toEqual(createZip(entries));
  });

  test.each([
    ["空の名前", ""],
    ["絶対パス", "/a.png"],
    ["親ディレクトリ", "../a.png"],
    ["途中の親ディレクトリ", "images/../a.png"],
    ["バックスラッシュ", "images\\a.png"],
    ["空のパス要素", "images//a.png"],
    ["末尾のスラッシュ", "images/"],
  ])("不正なパスは例外にする: %s", (_name, name) => {
    expect(() => createZip([{ name, data: bytes("x") }])).toThrow(
      "ZIP のパスが不正です",
    );
  });

  test("パスの重複は例外にする", () => {
    expect(() =>
      createZip([
        { name: "a.png", data: bytes("1") },
        { name: "a.png", data: bytes("2") },
      ]),
    ).toThrow("重複しています");
  });

  test("ファイルが無ければ例外にする", () => {
    expect(() => createZip([])).toThrow("ZIP に入れるファイルがありません");
  });
});
