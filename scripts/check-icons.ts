#!/usr/bin/env bun
// src-tauri/icons へコミットしたアイコンが、原本 assets/app-icon.png から生成した
// 結果と一致することを検査する。原本を差し替えて生成を忘れると、古いアイコンが
// ビルドへ入るため、CIとpre-commitで検出する。

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(repositoryRoot, "assets", "app-icon.png");
const committedDir = join(repositoryRoot, "src-tauri", "icons");

// 比較対象はGit管理対象のファイルに限る。作業ツリーを列挙すると、README の手順で
// tauri icon を実行した直後に残る未追跡の生成物（icon.icns、android、ios）を
// 巻き込む。とくに icon.icns は同一入力でも出力が変わるため、比較すると必ず失敗する。
function listTrackedFiles(): string[] {
  const result = spawnSync("git", ["ls-files", "--", "src-tauri/icons"], {
    cwd: repositoryRoot,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`git ls-files の実行に失敗しました: ${result.stderr}`);
  }

  return (
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.slice("src-tauri/icons/".length))
      // サブディレクトリの生成物は対象プラットフォームがWindowsのみのためコミットしていない。
      .filter((name) => !name.includes("/"))
      .sort()
  );
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

const generatedDir = mkdtempSync(join(tmpdir(), "md-peruse-icons-"));
try {
  const result = spawnSync(
    "bun",
    ["run", "tauri", "icon", sourcePath, "-o", generatedDir],
    { cwd: repositoryRoot, encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`tauri icon の実行に失敗しました: ${result.stderr}`);
  }

  const generated = new Set(listFiles(generatedDir));
  const mismatched: string[] = [];
  const missing: string[] = [];

  for (const name of listTrackedFiles()) {
    if (!generated.has(name)) {
      missing.push(name);
      continue;
    }
    const committedBytes = readFileSync(join(committedDir, name));
    const generatedBytes = readFileSync(join(generatedDir, name));
    if (!committedBytes.equals(generatedBytes)) {
      mismatched.push(name);
    }
  }

  if (missing.length > 0 || mismatched.length > 0) {
    const details = [
      missing.length > 0
        ? `生成されなかったファイル: ${missing.join(", ")}`
        : "",
      mismatched.length > 0
        ? `内容が一致しないファイル: ${mismatched.join(", ")}`
        : "",
    ].filter((line) => line.length > 0);
    throw new Error(
      `src-tauri/icons が assets/app-icon.png と一致しません。\n${details.join("\n")}\n` +
        "bun run tauri icon assets/app-icon.png を実行し、Windows向け以外の生成物を削除してからコミットしてください。",
    );
  }

  console.log(
    `src-tauri/icons は assets/app-icon.png と一致しています（${listTrackedFiles().length} ファイル）`,
  );
} finally {
  rmSync(generatedDir, { recursive: true, force: true });
}
