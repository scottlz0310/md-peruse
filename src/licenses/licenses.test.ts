import { describe, expect, test } from "bun:test";
import {
  filterPackages,
  LICENSES_URL,
  type LicensePackage,
  type LicensesFile,
  loadLicenses,
} from "./licenses";

function pkg(name: string): LicensePackage {
  return { name, version: "1.0.0", license: "MIT", texts: [] };
}

describe("loadLicenses", () => {
  const file: LicensesFile = {
    application: pkg("md-peruse"),
    licenseTexts: ["MIT License"],
    packages: [pkg("react")],
  };

  test("同梱した一覧を読み込む", async () => {
    const requested: string[] = [];
    const fetcher = (async (url: string) => {
      requested.push(url);
      return new Response(JSON.stringify(file));
    }) as unknown as typeof fetch;

    expect(await loadLicenses(fetcher)).toEqual(file);
    expect(requested).toEqual([LICENSES_URL]);
  });

  test.each([404, 500])(
    "HTTP %d のときは、原因の分かる失敗にする",
    async (status) => {
      const fetcher = (async () =>
        new Response("", { status })) as unknown as typeof fetch;

      await expect(loadLicenses(fetcher)).rejects.toThrow(
        `${LICENSES_URL} を読み込めません（HTTP ${status}）`,
      );
    },
  );
});

describe("filterPackages", () => {
  const packages = ["React", "react-dom", "@tauri-apps/api", "serde"].map(pkg);
  const names = (query: string) =>
    filterPackages(packages, query).map((entry) => entry.name);

  test.each([
    ["", ["React", "react-dom", "@tauri-apps/api", "serde"]],
    ["   ", ["React", "react-dom", "@tauri-apps/api", "serde"]],
    ["react", ["React", "react-dom"]],
    ["REACT", ["React", "react-dom"]],
    ["  tauri ", ["@tauri-apps/api"]],
    ["/api", ["@tauri-apps/api"]],
    ["nothing", []],
  ])("「%s」で絞り込む", (query, expected) => {
    expect(names(query)).toEqual(expected);
  });
});
