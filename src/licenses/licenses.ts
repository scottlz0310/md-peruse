/**
 * サードパーティライセンス一覧（design-decisions.md 11.3）。
 *
 * `scripts/generate-licenses.ts` が生成し、リリースのビルド（`tauri build`）が同梱する。
 * 生成物の形はここを正本とし、生成スクリプトも同じ型を使う。
 */

/** 生成物へ書かれた依存1件。 */
export type LicensePackage = {
  name: string;
  version: string;
  /** `package.json` や cargo-about が示すSPDX識別子。 */
  license: string;
  /**
   * ソースコードの入手先。EPL-2.0のように、オブジェクト形式で配布するときにも入手方法の
   * 案内を求めるライセンスの依存だけが持つ。
   */
  sourceUrl?: string;
  /**
   * 本文は `licenseTexts` のインデックスで参照する。同じ本文を多数のパッケージが共有する
   * ため、パッケージごとに持たせると生成物が数MBに達する。
   */
  texts: { label: string; index: number }[];
};

/** 生成物のJSON全体。 */
export type LicensesFile = {
  /** md-peruse自身。 */
  application: LicensePackage;
  licenseTexts: string[];
  /** JavaScriptの依存とRustのcrateを合わせ、名前順に並べたもの。 */
  packages: LicensePackage[];
};

/** 生成物の置き場所。Viteが `public/` をビルドの出力へそのまま複写する。 */
export const LICENSES_URL = "/third-party-licenses.json";

/**
 * ライセンス一覧を読み込む。
 *
 * 一覧は数百KBあるため、JavaScriptのバンドルへ入れず、ダイアログを開いたときにだけ
 * 読み込む。開発中は `bun run generate:licenses` で生成するまで存在しない。
 */
export async function loadLicenses(
  fetcher: typeof fetch = fetch,
): Promise<LicensesFile> {
  const response = await fetcher(LICENSES_URL);
  if (!response.ok) {
    throw new Error(
      `${LICENSES_URL} を読み込めません（HTTP ${response.status}）`,
    );
  }
  return (await response.json()) as LicensesFile;
}

/** 名前に `query` を含む依存へ絞り込む。大文字小文字は区別せず、前後の空白は無視する。 */
export function filterPackages(
  packages: readonly LicensePackage[],
  query: string,
): readonly LicensePackage[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return packages;
  return packages.filter((pkg) => pkg.name.toLowerCase().includes(needle));
}
