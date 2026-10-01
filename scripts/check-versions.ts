#!/usr/bin/env bun
// 製品バージョンを持つ各ファイルが一致していることを検査する。
//
// バージョンは次の場所に重複して書かれる。どれかだけを上げると、Storeへ出すMSIXの版と
// アプリが名乗る版がずれるため、CIとpre-commitで検出する。
//   - package.json                      version
//   - src-tauri/tauri.conf.json         version（build-msix.ps1 が Package Version の元にする）
//   - src-tauri/Cargo.toml              [package] version
//   - src-tauri/Cargo.lock              md-peruse の version
//   - packaging/Package.appxmanifest.template の Identity Version（置換子であること）
// タグ（refs/tags/vMAJOR.MINOR.PATCH）で実行されたときは、タグの版も照合する。
// 製品バージョンの正本はGitタグである（CHANGELOG.md）。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_VERSION_PLACEHOLDER = "__PACKAGE_VERSION__";

const SEMVER = /^\d+\.\d+\.\d+$/;

export interface VersionSources {
  packageJson: string;
  tauriConf: string;
  cargoToml: string;
  cargoLock: string;
  manifestTemplate: string;
  /** `refs/tags/v1.2.3` のような ref。タグでないときは undefined。 */
  gitRef?: string;
}

function tomlPackageVersion(toml: string): string | undefined {
  const section = /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml);
  return section
    ? /^version\s*=\s*"([^"]+)"/m.exec(section[1] ?? "")?.[1]
    : undefined;
}

function lockedVersion(lock: string, name: string): string | undefined {
  const entry = new RegExp(
    `^name = "${name}"\\r?\\nversion = "([^"]+)"`,
    "m",
  ).exec(lock);
  return entry?.[1];
}

/** 不一致と形式の誤りを、人が読める文で返す。空なら一致している。 */
export function findVersionProblems(sources: VersionSources): string[] {
  const problems: string[] = [];
  const found: Array<[string, string | undefined]> = [
    ["package.json", JSON.parse(sources.packageJson).version],
    ["src-tauri/tauri.conf.json", JSON.parse(sources.tauriConf).version],
    ["src-tauri/Cargo.toml", tomlPackageVersion(sources.cargoToml)],
    [
      "src-tauri/Cargo.lock (md-peruse)",
      lockedVersion(sources.cargoLock, "md-peruse"),
    ],
  ];

  for (const [label, version] of found) {
    if (version === undefined) {
      problems.push(`${label}: バージョンを読み取れません`);
    } else if (!SEMVER.test(version)) {
      problems.push(
        `${label}: '${version}' は MAJOR.MINOR.PATCH の形式ではありません`,
      );
    }
  }

  const reference = found[0]?.[1];
  for (const [label, version] of found.slice(1)) {
    if (version !== undefined && version !== reference) {
      problems.push(
        `${label}: '${version}' が package.json の '${reference}' と一致しません`,
      );
    }
  }

  // Package Version はビルド時に tauri.conf.json の版から作る。テンプレートが固定値を
  // 持つと、その置換が効かなくなる。
  const identity = /<Identity\b[^>]*?\bVersion="([^"]*)"/s.exec(
    sources.manifestTemplate,
  );
  if (identity?.[1] !== PACKAGE_VERSION_PLACEHOLDER) {
    problems.push(
      `packaging/Package.appxmanifest.template: Identity の Version が '${PACKAGE_VERSION_PLACEHOLDER}' ではありません（実際: '${identity?.[1] ?? "なし"}'）`,
    );
  }

  const tag = /^refs\/tags\/v(.+)$/.exec(sources.gitRef ?? "")?.[1];
  if (tag !== undefined && tag !== reference) {
    problems.push(
      `Gitタグ 'v${tag}' が package.json の '${reference}' と一致しません`,
    );
  }

  return problems;
}

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const read = (path: string) => readFileSync(join(root, path), "utf-8");
  const problems = findVersionProblems({
    packageJson: read("package.json"),
    tauriConf: read("src-tauri/tauri.conf.json"),
    cargoToml: read("src-tauri/Cargo.toml"),
    cargoLock: read("src-tauri/Cargo.lock"),
    manifestTemplate: read("packaging/Package.appxmanifest.template"),
    gitRef: process.env.GITHUB_REF,
  });

  if (problems.length > 0) {
    console.error("バージョンが一致していません:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("バージョンは一致しています。");
}
