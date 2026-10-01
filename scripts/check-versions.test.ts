import { describe, expect, test } from "bun:test";
import { findVersionProblems, type VersionSources } from "./check-versions";

const base: VersionSources = {
  packageJson: JSON.stringify({ version: "1.2.3" }),
  tauriConf: JSON.stringify({ version: "1.2.3" }),
  cargoToml:
    '[package]\nname = "md-peruse"\nversion = "1.2.3"\n\n[dependencies]\nversion = "9.9.9"\n',
  cargoLock:
    'name = "other"\nversion = "9.9.9"\n\n[[package]]\nname = "md-peruse"\nversion = "1.2.3"\n',
  manifestTemplate:
    '<Package>\n  <Identity\n    Name="x"\n    Version="__PACKAGE_VERSION__" />\n</Package>',
};

describe("findVersionProblems", () => {
  test("すべて一致していれば問題なし", () => {
    expect(findVersionProblems(base)).toEqual([]);
  });

  test("tauri.conf.json の不一致を検出する", () => {
    const problems = findVersionProblems({
      ...base,
      tauriConf: JSON.stringify({ version: "1.2.4" }),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("tauri.conf.json");
  });

  test("Cargo.toml は [package] の version だけを読む", () => {
    const problems = findVersionProblems({
      ...base,
      cargoToml:
        '[dependencies]\nversion = "1.2.3"\n[package]\nversion = "2.0.0"\n',
    });
    expect(problems.join("\n")).toContain("Cargo.toml");
  });

  test("Cargo.lock の md-peruse の不一致を検出する", () => {
    const problems = findVersionProblems({
      ...base,
      cargoLock: 'name = "md-peruse"\nversion = "1.2.2"\n',
    });
    expect(problems.join("\n")).toContain("Cargo.lock");
  });

  test("プレリリース等 MAJOR.MINOR.PATCH 以外の形式を拒否する", () => {
    const problems = findVersionProblems({
      ...base,
      packageJson: JSON.stringify({ version: "1.2.3-beta" }),
    });
    expect(problems.join("\n")).toContain("形式");
  });

  test("マニフェストテンプレートが固定値を持つと検出する", () => {
    const problems = findVersionProblems({
      ...base,
      manifestTemplate: '<Identity Version="1.2.3.0" />',
    });
    expect(problems.join("\n")).toContain("__PACKAGE_VERSION__");
  });

  test("タグが版と食い違うと検出し、一致すれば通す", () => {
    expect(
      findVersionProblems({ ...base, gitRef: "refs/tags/v1.2.4" }).join("\n"),
    ).toContain("Gitタグ");
    expect(
      findVersionProblems({ ...base, gitRef: "refs/tags/v1.2.3" }),
    ).toEqual([]);
    expect(findVersionProblems({ ...base, gitRef: "refs/heads/main" })).toEqual(
      [],
    );
  });
});
