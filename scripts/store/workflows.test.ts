// 承認の基準（2026-10-12 にユーザーが決めた）: 承認を残すのは、不可逆な操作と、外部への書き込みを伴う作業だけ。
// 読み取りだけのモードは、承認のない Environment `store-readonly` で動かす。その資格情報は、書き込みもできる
// 強さなので、「読み取りのモードだけが、承認のないジョブへ行く」ことを、ワークフローの構造で固定する。

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MODES, READ_ONLY_MODES, WRITE_MODES } from "./insights";
import { READ_ONLY_SUBMIT_MODES, WRITE_SUBMIT_MODES } from "./submit";

const WORKFLOWS_DIR = fileURLToPath(
  new URL("../../.github/workflows/", import.meta.url),
);

interface Step {
  run?: string;
}

interface Job {
  environment?: string;
  if?: string;
  steps: Step[];
}

interface Workflow {
  on: { workflow_dispatch?: { inputs?: { mode?: { options?: string[] } } } };
  jobs: Record<string, Job>;
}

function load(file: string): Workflow {
  return Bun.YAML.parse(
    readFileSync(`${WORKFLOWS_DIR}${file}`, "utf8"),
  ) as Workflow;
}

/** `${{ inputs.mode == 'a' || inputs.mode == 'b' }}` から、モードの集合を取り出す。 */
function modesIn(condition: string | undefined): string[] {
  return [...(condition ?? "").matchAll(/inputs\.mode == '([a-z-]+)'/g)]
    .map((m) => m[1] as string)
    .sort();
}

const runOf = (job: Job) => job.steps.map((s) => s.run ?? "").join("\n");

describe.each([
  {
    file: "store-insights.yml",
    readModes: READ_ONLY_MODES,
    writeModes: WRITE_MODES,
  },
  {
    file: "store-submit.yml",
    readModes: READ_ONLY_SUBMIT_MODES,
    writeModes: WRITE_SUBMIT_MODES,
  },
])("$file", ({ file, readModes, writeModes }) => {
  const workflow = load(file);
  const read = workflow.jobs.read as Job;
  const write = workflow.jobs.write as Job;

  test("ジョブは、読み取り（read）と書き込み（write）の2つだけ", () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(["read", "write"]);
  });

  test("読み取りは承認のない store-readonly、書き込みは承認のある store-production", () => {
    expect(read.environment).toBe("store-readonly");
    expect(write.environment).toBe("store-production");
  });

  test("読み取りのジョブは、読み取りのモードだけを受ける（コードの分類と一致）", () => {
    expect(modesIn(read.if)).toEqual([...readModes].sort());
    expect(modesIn(write.if)).toEqual([...writeModes].sort());
  });

  test("入力のモードの選択肢は、読み取りと書き込みの和集合で、重なりも漏れもない", () => {
    const options = [
      ...(workflow.on.workflow_dispatch?.inputs?.mode?.options ?? []),
    ].sort();
    expect(options).toEqual([...readModes, ...writeModes].sort());
    expect(readModes.filter((m) => writeModes.includes(m))).toEqual([]);
  });

  test("読み取りのジョブは `--read-only` を渡し、書き込みのジョブは渡さない", () => {
    expect(runOf(read)).toContain("--read-only");
    expect(runOf(write)).not.toContain("--read-only");
  });
});

describe("store-insights のコード上の分類", () => {
  test("MODES は、読み取りと書き込みの和集合（分類の漏れがない）", () => {
    expect([...MODES].sort()).toEqual(
      [...READ_ONLY_MODES, ...WRITE_MODES].sort(),
    );
  });
});

describe("store-submit の読み取りのジョブは、書き込みの引数を持たない", () => {
  test.each(["--apply", "--clone-only", "--no-commit"])("%s", (flag) => {
    const read = load("store-submit.yml").jobs.read as Job;
    expect(runOf(read)).not.toContain(flag);
  });
});

describe("全ワークフロー", () => {
  const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml"));

  test("store-readonly を使うジョブは、必ず `--read-only` を渡す", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const [name, job] of Object.entries(load(file).jobs)) {
        if (
          job.environment === "store-readonly" &&
          !runOf(job).includes("--read-only")
        ) {
          offenders.push(`${file}:${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
