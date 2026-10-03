// 掲載情報 CSV から、申請の掲載情報（listings）へ反映する内容を取り出す。
//
// CSV にある 454 行のうち、反映するのは、ここに列挙した項目だけ（許可リスト）。
// 列挙にない項目（ロゴ、トレーラー、ハードウェア要件など）は、公開済みの内容を引き継いだまま触らない。
// 値が空の項目は「未指定」で、申請の値を変えない。空にして消す操作はできない（意図しない消去を避けるため）。

import { cellValue, type ListingTable } from "./csv";

/** CSV の Field → 申請の `baseListing` のキー。 */
export const TEXT_FIELDS = [
  ["Title", "title"],
  ["Description", "description"],
  ["ReleaseNotes", "releaseNotes"],
  ["ShortTitle", "shortTitle"],
  ["SortTitle", "sortTitle"],
  ["VoiceTitle", "voiceTitle"],
  ["ShortDescription", "shortDescription"],
  ["DevStudio", "devStudio"],
  ["CopyrightTrademarkInformation", "copyrightAndTrademarkInfo"],
  ["AdditionalLicenseTerms", "licenseTerms"],
] as const;

export type TextKey = (typeof TEXT_FIELDS)[number][1];

/** 配列の項目。Partner Center の上限（機能 20、検索語 7、デスクトップのスクリーンショット 30）。 */
export const FEATURE_LIMIT = 20;
export const KEYWORD_LIMIT = 7;
export const SCREENSHOT_LIMIT = 30;

export interface ImageSpec {
  /** CSV に書かれた相対パス（選ぶフォルダー名から始まる）。 */
  path: string;
  /** 字幕（申請の `description`）。 */
  description: string;
  imageType: "Screenshot";
}

export interface ListingPatch {
  language: string;
  text: Partial<Record<TextKey, string>>;
  features?: string[];
  keywords?: string[];
  /** デスクトップのスクリーンショット。無ければ画像は変えない。 */
  screenshots?: ImageSpec[];
}

function numbered(
  table: ListingTable,
  prefix: string,
  count: number,
  language: string,
): string[] {
  const values: string[] = [];
  for (let n = 1; n <= count; n++) {
    const value = cellValue(table, `${prefix}${n}`, language).trim();
    if (value !== "") values.push(value);
  }
  return values;
}

export function buildListingPatch(
  table: ListingTable,
  language: string,
): ListingPatch {
  if (!table.columns.includes(language)) {
    throw new Error(
      `掲載情報 CSV に言語の列がありません: ${language}（列: ${table.columns.join(", ")}）`,
    );
  }

  const patch: ListingPatch = { language, text: {} };

  for (const [field, key] of TEXT_FIELDS) {
    // 改行は変換しない。複数行の値は CRLF で、Partner Center のエクスポートも同じ形である
    // （変換すると、実行のたびに偽の差分が出る）。
    const value = cellValue(table, field, language).trim();
    if (value !== "") patch.text[key] = value;
  }

  const features = numbered(table, "Feature", FEATURE_LIMIT, language);
  if (features.length > 0) patch.features = features;

  const keywords = numbered(table, "SearchTerm", KEYWORD_LIMIT, language);
  if (keywords.length > 0) patch.keywords = keywords;

  const screenshots: ImageSpec[] = [];
  for (let n = 1; n <= SCREENSHOT_LIMIT; n++) {
    const path = cellValue(table, `DesktopScreenshot${n}`, language).trim();
    if (path === "") continue;
    screenshots.push({
      path,
      description: cellValue(
        table,
        `DesktopScreenshotCaption${n}`,
        language,
      ).trim(),
      imageType: "Screenshot",
    });
  }
  if (screenshots.length > 0) patch.screenshots = screenshots;

  return patch;
}
