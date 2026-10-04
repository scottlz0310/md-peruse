#!/usr/bin/env bun
// Microsoft Store への提出（パッケージの差し替えと、掲載情報の更新）を、Submission API で行う。
//
//   bun run scripts/store/submit.ts --listing docs/assets/store [--languages ja-jp,en-us] \
//       [--replace-screenshots] [--package <.msixupload>] [--publish-mode Manual|Immediate] \
//       [--apply] [--no-commit]
//
// 既定は dry-run で、読み取りだけを行い、何が変わるかを表示する。`--apply` を付けたときだけ、
// 申請（下書き）を作り、変更して、ZIP をアップロードし、commit する。
// 公開のしかたは、申請が引き継いだ設定に従う（Manual: 認定の後に人が「今すぐ公開」を押す。
// Immediate: 認定の後にすぐ公開される）。`--publish-mode`（既定 Manual）に期待を明示し、申請の
// 設定と違えば止める。公開方法は、このスクリプトでは変更しない（Partner Center の申請オプション）。
//
// 認証情報は環境変数で渡す: STORE_PRODUCT_ID、AZURE_AD_TENANT_ID、
// AZURE_AD_APPLICATION_CLIENT_ID、AZURE_AD_APPLICATION_SECRET（GitHub の Environment の
// secret / 変数。値はログに出さない）。
//
// 注意: この API で作った申請は、以後 Partner Center の画面で変更しない。画面で変更すると、
// その申請を API で変更も commit もできなくなる。

import { appendFileSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { StoreClient, waitForCommit } from "./client";
import { readListingTable } from "./csv";
import { buildListingPatch, type ListingPatch } from "./listing";
import {
  assertNoPendingSubmission,
  assertPublishMode,
  describePlan,
  diffTopLevel,
  initializeDeviceFamilies,
  type PlanInput,
  PUBLISH_MODES,
  type PublishMode,
  planSubmission,
  type SubmissionPlan,
} from "./plan";
import { createZip } from "./zip";

export interface RunOptions {
  /** `listingData.csv` と画像を直下に置いたフォルダー（インポート用フォルダー）。 */
  listingDir?: string;
  languages: string[];
  replaceScreenshots: boolean;
  packagePath?: string;
  /** 申請が引き継いでいるはずの公開方法。違えば止める。 */
  publishMode: PublishMode;
  apply: boolean;
  commit: boolean;
  /** 申請（下書き）を作って、公開済みの申請との違いを表示するだけで止める（更新も commit もしない）。 */
  cloneOnly: boolean;
}

export interface RunDeps {
  client: Pick<
    StoreClient,
    | "getApplication"
    | "getSubmission"
    | "createSubmission"
    | "updateSubmission"
    | "uploadZip"
    | "commit"
    | "getStatus"
  >;
  readText: (path: string) => string;
  readBytes: (path: string) => Uint8Array;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

export interface RunResult {
  mode: "dry-run" | "no-changes" | "cloned" | "applied";
  plan: SubmissionPlan;
  submissionId?: string;
  /** commit した場合の、commit 受理後の状態。 */
  status?: string;
}

const COMMIT_POLL = { intervalMs: 5_000, maxAttempts: 60 };

function buildInput(options: RunOptions, deps: RunDeps): PlanInput {
  if (!options.listingDir && !options.packagePath) {
    throw new Error("--listing か --package の少なくとも一方が必要です");
  }
  if (options.cloneOnly && !options.apply) {
    throw new Error(
      "--clone-only は申請（下書き）を作るので、--apply が必要です",
    );
  }
  if (options.replaceScreenshots && !options.listingDir) {
    throw new Error("--replace-screenshots には --listing が必要です");
  }

  let patches: ListingPatch[] = [];
  let listingRoot = "";
  const listingDir = options.listingDir;
  if (listingDir) {
    const table = readListingTable(
      deps.readText(join(listingDir, "listingData.csv")),
    );
    patches = options.languages.map((language) =>
      buildListingPatch(table, language),
    );
    listingRoot = basename(resolve(listingDir));
  }

  return {
    patches,
    replaceScreenshots: options.replaceScreenshots,
    listingRoot,
    readImage: (relative) => deps.readBytes(join(listingDir ?? "", relative)),
    packageFile: options.packagePath
      ? {
          name: basename(options.packagePath),
          data: deps.readBytes(options.packagePath),
        }
      : undefined,
  };
}

export async function run(
  options: RunOptions,
  deps: RunDeps,
): Promise<RunResult> {
  const input = buildInput(options, deps);
  const { client, log } = deps;

  const app = await client.getApplication();
  assertNoPendingSubmission(app);
  const lastPublishedId = app.lastPublishedApplicationSubmission?.id;
  if (!lastPublishedId) {
    throw new Error(
      "公開済みの申請が見つかりません。初回の提出は手動で行ってください",
    );
  }

  // 作成の前に、公開済みの申請に対する計画を作る。変更が無いなら、申請（下書き）を作らない。
  const published = await client.getSubmission(lastPublishedId);
  assertPublishMode(published, options.publishMode);
  const preview = planSubmission(published, input);
  log(describePlan(preview));
  // Pricing Version 2 のアプリは、API が価格を unknown tier で返す（資料の定め）。実際の値を残す。
  log(`価格（公開済み）: ${JSON.stringify(published.pricing ?? null)}`);
  log(
    `デバイス ファミリー（公開済み）: ${JSON.stringify(published.allowTargetFutureDeviceFamilies ?? null)}`,
  );

  if (!options.apply) return { mode: "dry-run", plan: preview };
  if (preview.changes.length === 0 && !options.cloneOnly) {
    return { mode: "no-changes", plan: preview };
  }

  const created = await client.createSubmission();
  assertPublishMode(created, options.publishMode);

  // 作成した申請は、公開済みの申請の複製のはず。違う項目があれば、更新の前に止める
  // （価格など、このツールが扱わない項目が、意図せず変わるのを防ぐ）。
  const cloneDiff = diffTopLevel(published, created);
  log(
    `作成した申請（${created.id}）と公開済みの申請の違い（トップレベル）: ${cloneDiff.length > 0 ? cloneDiff.join(", ") : "なし"}`,
  );
  log(`価格（作成した申請）: ${JSON.stringify(created.pricing ?? null)}`);
  log(
    `デバイス ファミリー（作成した申請）: ${JSON.stringify(created.allowTargetFutureDeviceFamilies ?? null)}`,
  );
  if (options.cloneOnly) {
    log(
      `確認用に申請 ${created.id} を作りました。更新も commit もしていません。Partner Center の「送信の削除」で消してください`,
    );
    return { mode: "cloned", plan: preview, submissionId: created.id };
  }
  if (cloneDiff.length > 0) {
    throw new Error(
      `作成した申請（${created.id}）が、公開済みの申請の複製ではありません（違う項目: ${cloneDiff.join(", ")}）。` +
        "更新せずに止めます。申請は残っています。Partner Center で内容を確認し、不要なら削除してください",
    );
  }
  const plan = planSubmission(created, input);

  // 作成した申請をそのまま PUT すると、API は、デバイス ファミリーの未初期化を理由に拒否する。
  // 利用者が望んだ変更ではないので、計画（変更の一覧）には含めず、初期化した内容をログに残す。
  for (const init of initializeDeviceFamilies(plan.submission)) {
    log(
      `allowTargetFutureDeviceFamilies.${init.family} を初期化しました: ${JSON.stringify(init.before ?? null)} → ${init.after}`,
    );
  }

  await client.updateSubmission(plan.submission);
  log(`申請 ${created.id} を更新しました`);

  if (plan.uploads.length > 0) {
    if (!created.fileUploadUrl) {
      throw new Error("申請に fileUploadUrl がありません（ZIP を送れません）");
    }
    await client.uploadZip(created.fileUploadUrl, createZip(plan.uploads));
    log(`ZIP をアップロードしました（${plan.uploads.length} ファイル）`);
  }

  if (!options.commit) {
    log(
      `commit していません。申請 ${created.id} は下書きのままです（画面で変更しないでください）`,
    );
    return { mode: "applied", plan, submissionId: created.id };
  }

  await client.commit(created.id);
  const status = await waitForCommit(client, created.id, {
    sleep: deps.sleep,
    ...COMMIT_POLL,
  });
  if (status.status === "CommitFailed") {
    throw new Error(
      `commit に失敗しました（申請 ${created.id}）: ${JSON.stringify(status.statusDetails)}`,
    );
  }
  log(`commit を受理しました（状態: ${status.status}）`);
  return {
    mode: "applied",
    plan,
    submissionId: created.id,
    status: status.status,
  };
}

function requiredEnv(env: NodeJS.ProcessEnv, names: string[]): string[] {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`環境変数が未設定です: ${missing.join(", ")}`);
  }
  return names.map((name) => env[name] as string);
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        listing: { type: "string" },
        languages: { type: "string", default: "ja-jp,en-us" },
        package: { type: "string" },
        "replace-screenshots": { type: "boolean", default: false },
        "publish-mode": { type: "string", default: "Manual" },
        apply: { type: "boolean", default: false },
        "no-commit": { type: "boolean", default: false },
        "clone-only": { type: "boolean", default: false },
      },
    });

    const publishMode = values["publish-mode"] as string;
    if (!(PUBLISH_MODES as readonly string[]).includes(publishMode)) {
      throw new Error(
        `--publish-mode は ${PUBLISH_MODES.join(" か ")} を指定してください: ${publishMode}`,
      );
    }

    const [appId, tenantId, clientId, clientSecret] = requiredEnv(process.env, [
      "STORE_PRODUCT_ID",
      "AZURE_AD_TENANT_ID",
      "AZURE_AD_APPLICATION_CLIENT_ID",
      "AZURE_AD_APPLICATION_SECRET",
    ]) as [string, string, string, string];

    const summary = process.env.GITHUB_STEP_SUMMARY;
    const result = await run(
      {
        listingDir: values.listing,
        languages: (values.languages as string).split(",").map((s) => s.trim()),
        replaceScreenshots: values["replace-screenshots"] as boolean,
        packagePath: values.package,
        publishMode: publishMode as PublishMode,
        apply: values.apply as boolean,
        commit: !(values["no-commit"] as boolean),
        cloneOnly: values["clone-only"] as boolean,
      },
      {
        client: new StoreClient({
          fetch: (input, init) => fetch(input, init),
          appId,
          tenantId,
          clientId,
          clientSecret,
        }),
        readText: (path) => readFileSync(path, "utf8"),
        readBytes: (path) => new Uint8Array(readFileSync(path)),
        sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
        log: (message) => console.log(message),
      },
    );

    console.log(
      `結果: ${result.mode}${result.submissionId ? `（申請 ${result.submissionId}）` : ""}`,
    );
    if (summary) {
      appendFileSync(
        summary,
        `## Store 提出（${result.mode}）\n\n${describePlan(result.plan)}\n\n${
          result.submissionId
            ? `申請: \`${result.submissionId}\`（状態: ${result.status ?? "未 commit"}）\n`
            : ""
        }`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
