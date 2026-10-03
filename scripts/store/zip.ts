// 申請へアップロードする ZIP を作る（無圧縮の STORE 方式）。
//
// Submission API は、パッケージと掲載画像を 1 つの ZIP にまとめて、申請ごとの SAS URL へ
// アップロードさせる。PNG と MSIX は圧縮済みなので、圧縮せずに格納する。
// ZIP64 には対応しない（4 GiB 未満、65535 ファイル未満）。更新日時は固定し、同じ入力から同じ
// バイト列ができるようにする（テストと、証跡のハッシュ照合のため）。

export interface ZipEntry {
  /** ZIP 内の相対パス。`/` 区切り。 */
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertSafeName(name: string): void {
  if (
    name === "" ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`ZIP のパスが不正です: ${JSON.stringify(name)}`);
  }
}

/** 1980-01-01 00:00:00（DOS 形式の時刻と日付）。 */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** 名前を UTF-8 として扱う印（日本語のファイル名のため）。 */
const FLAG_UTF8 = 0x0800;

export function createZip(entries: ZipEntry[]): Uint8Array {
  if (entries.length === 0) throw new Error("ZIP に入れるファイルがありません");
  if (entries.length >= 0xffff) throw new Error("ZIP のファイル数が多すぎます");

  const seen = new Set<string>();
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    assertSafeName(entry.name);
    if (seen.has(entry.name)) {
      throw new Error(`ZIP のパスが重複しています: ${entry.name}`);
    }
    seen.add(entry.name);
    if (entry.data.length >= 0xffffffff) {
      throw new Error(`ZIP に入れるファイルが大きすぎます: ${entry.name}`);
    }

    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + name.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // 展開に必要な版
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint16(8, 0, true); // STORE
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // 作成した版
    cv.setUint16(6, 20, true);
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const zip = new Uint8Array(offset + centralSize + end.length);
  let position = 0;
  for (const part of [...locals, ...centrals, end]) {
    zip.set(part, position);
    position += part.length;
  }
  return zip;
}
