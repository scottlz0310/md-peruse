#!/usr/bin/env bun
// 同梱するサードパーティ依存のライセンス一覧を生成する。
// JavaScript側は package.json の dependencies から推移閉包を辿り、node_modules の
// メタデータとライセンス本文を収集する。Rust側は cargo-about の出力を取り込む。
// 生成物はリポジトリへコミットし、CIが再生成して差分の有無を検査する。

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(
  repositoryRoot,
  "src",
  "generated",
  "third-party-licenses.json",
);

// SPDX表記のゆれを避けるため、収集対象のライセンス本文はファイル名で判定する。
const licenseFilePattern = /^(LICENSE|LICENCE|COPYING|NOTICE)([._-].*)?$/i;

type LicenseSource = {
  // JavaScriptはファイル名、Rustは cargo-about が判定したSPDX識別子。
  label: string;
  text: string;
};

type CollectedPackage = {
  name: string;
  version: string;
  license: string;
  sources: LicenseSource[];
};

type PackageManifest = {
  name?: string;
  version?: string;
  license?: string;
  licenses?: { type?: string }[];
  dependencies?: Record<string, string>;
};

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf-8")) as PackageManifest;
}

function resolveLicense(manifest: PackageManifest): string {
  if (manifest.license) {
    return manifest.license;
  }
  // 古いパッケージは licenses 配列で表記する。
  const types = manifest.licenses
    ?.map((entry) => entry.type)
    .filter((type) => type !== undefined);
  if (types && types.length > 0) {
    return types.join(" OR ");
  }
  throw new Error(`${manifest.name} はライセンスを宣言していません`);
}

function collectLicenseFiles(packageDir: string): LicenseSource[] {
  return readdirSync(packageDir)
    .filter((entry) => licenseFilePattern.test(entry))
    .sort()
    .map((entry) => ({
      label: entry,
      text: readFileSync(join(packageDir, entry), "utf-8").trimEnd(),
    }));
}

// 配布物へ入るのは dependencies とその推移閉包に限られる。devDependencies は対象外。
// Bunはnode_modulesをhoistするため、ルートのnode_modules配下を探索する。
function collectJavaScriptPackages(): CollectedPackage[] {
  const rootManifest = readManifest(join(repositoryRoot, "package.json"));
  const pending = Object.keys(rootManifest.dependencies ?? {});
  const visited = new Set<string>();
  const packages: CollectedPackage[] = [];

  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || visited.has(name)) {
      continue;
    }
    visited.add(name);

    const packageDir = join(repositoryRoot, "node_modules", name);
    const manifestPath = join(packageDir, "package.json");
    if (!existsSync(manifestPath)) {
      throw new Error(
        `${name} が node_modules に見つかりません。bun install を実行してください`,
      );
    }

    const manifest = readManifest(manifestPath);
    packages.push({
      name,
      version: manifest.version ?? "",
      license: resolveLicense(manifest),
      sources: collectLicenseFiles(packageDir),
    });
    pending.push(...Object.keys(manifest.dependencies ?? {}));
  }

  return packages;
}

type CargoAboutLicense = {
  name?: string;
  id?: string;
  text?: string;
  used_by?: { crate?: { name?: string; version?: string } }[];
};

// cargo-about の出力はライセンス本文単位のため、crate単位へ組み替える。
function collectRustPackages(): CollectedPackage[] {
  // cargo-about は標準出力のリダイレクトを拒否するため、一時ファイルへ出力させる。
  const jsonPath = join(
    mkdtempSync(join(tmpdir(), "md-peruse-licenses-")),
    "licenses.json",
  );
  const result = spawnSync(
    "cargo",
    ["about", "generate", "--format", "json", "--output-file", jsonPath],
    { cwd: join(repositoryRoot, "src-tauri"), encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`cargo about の実行に失敗しました: ${result.stderr}`);
  }

  const licenses = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
    licenses?: CargoAboutLicense[];
  };
  const byCrate = new Map<string, CollectedPackage>();

  for (const license of licenses.licenses ?? []) {
    const identifier = license.id ?? license.name ?? "";
    for (const user of license.used_by ?? []) {
      const name = user.crate?.name;
      if (name === undefined) {
        continue;
      }
      const version = user.crate?.version ?? "";
      const source: LicenseSource = {
        label: identifier,
        text: (license.text ?? "").trimEnd(),
      };
      const existing = byCrate.get(`${name}@${version}`);
      if (existing === undefined) {
        byCrate.set(`${name}@${version}`, {
          name,
          version,
          license: identifier,
          sources: [source],
        });
        continue;
      }
      if (!existing.license.split(" OR ").includes(identifier)) {
        existing.license = `${existing.license} OR ${identifier}`;
      }
      existing.sources.push(source);
    }
  }

  return [...byCrate.values()];
}

type EmittedPackage = {
  name: string;
  version: string;
  license: string;
  // licenseTexts のインデックス。同じ本文を複数のパッケージが共有するため、
  // 本文を分離しないと生成物が数MBに達する。
  texts: { label: string; index: number }[];
};

function emit(packages: CollectedPackage[], texts: string[]): EmittedPackage[] {
  return packages
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      texts: pkg.sources.map((source) => {
        let index = texts.indexOf(source.text);
        if (index === -1) {
          index = texts.push(source.text) - 1;
        }
        return { label: source.label, index };
      }),
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    );
}

const licenseTexts: string[] = [];
const javascript = emit(
  collectJavaScriptPackages().sort((a, b) => a.name.localeCompare(b.name)),
  licenseTexts,
);
const rust = emit(
  collectRustPackages().sort((a, b) => a.name.localeCompare(b.name)),
  licenseTexts,
);

writeFileSync(
  outputPath,
  `${JSON.stringify({ licenseTexts, javascript, rust }, null, 2)}\n`,
  "utf-8",
);
console.log(
  `${outputPath} を生成しました（JavaScript ${javascript.length} 件、Rust ${rust.length} 件、ライセンス本文 ${licenseTexts.length} 件）`,
);
