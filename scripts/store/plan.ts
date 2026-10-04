// 公開済みの申請（のコピー）に対して、何をどう変えるかの計画を作る。
//
// ここは副作用を持たない。申請の JSON を複製して書き換え、変更の一覧（差分）と、ZIP に入れる
// ファイルを返す。ネットワークとファイルの読み込みは、呼び出し側が渡す。
// 申請の JSON は、ここで扱わない項目（価格、年齢区分、プロパティなど）を含めて、そのまま保つ。

import { type ImageSpec, type ListingPatch, TEXT_FIELDS } from "./listing";
import type { ZipEntry } from "./zip";

export interface StoreImage {
  fileName: string;
  fileStatus: string;
  id?: string;
  description?: string;
  imageType: string;
  [key: string]: unknown;
}

export interface BaseListing {
  images?: StoreImage[];
  features?: string[];
  keywords?: string[];
  [key: string]: unknown;
}

export interface StorePackage {
  fileName: string;
  fileStatus: string;
  minimumDirectXVersion?: string;
  minimumSystemRam?: string;
  [key: string]: unknown;
}

export interface StoreSubmission {
  id: string;
  targetPublishMode: string;
  status?: string;
  fileUploadUrl?: string;
  listings: Record<
    string,
    { baseListing: BaseListing; [key: string]: unknown }
  >;
  applicationPackages: StorePackage[];
  [key: string]: unknown;
}

export interface StoreApplication {
  id: string;
  primaryName?: string;
  pendingApplicationSubmission?: { id: string };
  lastPublishedApplicationSubmission?: { id: string };
  [key: string]: unknown;
}

export interface Change {
  /** 言語（`ja-jp` など）または `package`。 */
  scope: string;
  field: string;
  kind: "set" | "add" | "delete";
  before?: string;
  after?: string;
}

export interface PlanInput {
  patches: ListingPatch[];
  /** true のときだけ、スクリーンショットを CSV の内容で入れ替える。 */
  replaceScreenshots: boolean;
  /** インポート用フォルダーの名前。CSV の画像の参照は、この名前から始まる。 */
  listingRoot: string;
  /** フォルダー内の相対パスから、画像のバイト列を読む。 */
  readImage: (relativePath: string) => Uint8Array;
  /** 指定すると、パッケージを差し替える。 */
  packageFile?: { name: string; data: Uint8Array };
}

export interface SubmissionPlan {
  submission: StoreSubmission;
  changes: Change[];
  /** ZIP に入れるファイル。空なら、アップロードは要らない。 */
  uploads: ZipEntry[];
}

/** 処理中の申請があれば例外にする。自動では消さない（人が内容を確かめてから消す）。 */
export function assertNoPendingSubmission(app: StoreApplication): void {
  if (app.pendingApplicationSubmission) {
    throw new Error(
      `処理中の申請が残っています（id: ${app.pendingApplicationSubmission.id}）。` +
        "自動では消しません。Partner Center で内容を確認し、不要なら削除してから再実行してください。",
    );
  }
}

/** 扱える公開方法。`SpecificDate` は公開日の指定が要るので扱わない。 */
export const PUBLISH_MODES = ["Manual", "Immediate"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

/**
 * 申請の公開方法が、期待した方法と違えば例外にする。公開済みの申請を引き継ぐため、
 * 公開方法が意図せず変わっていても気づけるようにする（認定の後の公開のしかたを取り違えない）。
 */
export function assertPublishMode(
  submission: StoreSubmission,
  expected: PublishMode,
): void {
  if (submission.targetPublishMode !== expected) {
    throw new Error(
      `公開方法が期待と違います（申請: ${submission.targetPublishMode}、期待: ${expected}）。` +
        "認定の後の公開のしかたを取り違えないよう、止めます。Partner Center の申請オプションと --publish-mode を確認してください。",
    );
  }
}

/**
 * 申請ごとに変わる項目。複製の比較では無視する。`friendlyName` は、申請を作るたびに API が
 * 付ける表示名で、初回の実走（2026-10-04）で、公開済みの申請との唯一の違いとして見つかった。
 */
const VOLATILE_KEYS = new Set([
  "id",
  "friendlyName",
  "status",
  "statusDetails",
  "fileUploadUrl",
  "resourceLocation",
]);

/**
 * JSON の値の構造比較。オブジェクトのキー順は問わず（API の応答で順序が変わっても同じ内容と
 * みなす）、配列の順序は区別する（画像の並びなど、順序に意味があるため）。
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => deepEqual(value, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]),
    )
  );
}

/**
 * 2 つの申請で、内容が違うトップレベルの項目の名前を返す。作成した申請が、公開済みの申請の
 * 複製になっているかを確かめるために使う（価格など、扱わない項目の変化に気づくため）。
 */
export function diffTopLevel(a: StoreSubmission, b: StoreSubmission): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((key) => !VOLATILE_KEYS.has(key))
    .filter((key) => !deepEqual(a[key], b[key]))
    .sort();
}

function preview(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const flat = value.replaceAll("\r\n", "↵").replaceAll("\n", "↵");
  return flat.length > 60 ? `${flat.slice(0, 60)}…（${value.length}字）` : flat;
}

function sameList(a: string[] | undefined, b: string[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b);
}

/** CSV の画像の参照（`store/screenshot1.png`）を、フォルダー内の相対パスへ直す。 */
export function resolveImagePath(path: string, listingRoot: string): string {
  const prefix = `${listingRoot}/`;
  const relative = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  if (
    relative === "" ||
    relative.startsWith("/") ||
    relative.includes("\\") ||
    relative.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(
      `画像の参照が不正です: ${JSON.stringify(path)}（インポート用フォルダー名 ${listingRoot}/ で始まる相対パスにしてください）`,
    );
  }
  return relative;
}

function planScreenshots(
  language: string,
  baseListing: BaseListing,
  screenshots: ImageSpec[],
  input: PlanInput,
  changes: Change[],
  uploads: ZipEntry[],
): void {
  const images = baseListing.images ?? [];
  for (const image of images) {
    if (
      image.imageType === "Screenshot" &&
      image.fileStatus !== "PendingDelete"
    ) {
      changes.push({
        scope: language,
        field: "screenshot",
        kind: "delete",
        before: preview(image.description ?? image.fileName),
      });
      image.fileStatus = "PendingDelete";
    }
  }

  for (const [index, spec] of screenshots.entries()) {
    const relative = resolveImagePath(spec.path, input.listingRoot);
    const base = relative.split("/").pop() as string;
    // 言語ごとに別のパスにする（同じ画像を複数の言語で使えるように）。
    const fileName = `images/${language}/${String(index + 1).padStart(2, "0")}-${base}`;
    uploads.push({ name: fileName, data: input.readImage(relative) });
    images.push({
      fileName,
      fileStatus: "PendingUpload",
      description: spec.description,
      imageType: spec.imageType,
    });
    changes.push({
      scope: language,
      field: "screenshot",
      kind: "add",
      after: preview(`${index + 1}. ${spec.description || base}`),
    });
  }
  baseListing.images = images;
}

export function planSubmission(
  base: StoreSubmission,
  input: PlanInput,
): SubmissionPlan {
  const submission = structuredClone(base);
  const changes: Change[] = [];
  const uploads: ZipEntry[] = [];

  for (const patch of input.patches) {
    const listing = submission.listings[patch.language];
    if (!listing) {
      throw new Error(
        `申請に掲載情報の言語がありません: ${patch.language}（申請の言語: ${Object.keys(submission.listings).join(", ")}）`,
      );
    }
    const baseListing = listing.baseListing;

    for (const [, key] of TEXT_FIELDS) {
      const value = patch.text[key];
      if (value === undefined) continue;
      const current = baseListing[key];
      if (current === value) continue;
      changes.push({
        scope: patch.language,
        field: key,
        kind: "set",
        before: preview(typeof current === "string" ? current : undefined),
        after: preview(value),
      });
      baseListing[key] = value;
    }

    if (patch.features && !sameList(baseListing.features, patch.features)) {
      changes.push({
        scope: patch.language,
        field: "features",
        kind: "set",
        before: `${baseListing.features?.length ?? 0}件`,
        after: `${patch.features.length}件`,
      });
      baseListing.features = patch.features;
    }

    if (patch.keywords && !sameList(baseListing.keywords, patch.keywords)) {
      changes.push({
        scope: patch.language,
        field: "keywords",
        kind: "set",
        before: baseListing.keywords?.join(", "),
        after: patch.keywords.join(", "),
      });
      baseListing.keywords = patch.keywords;
    }

    if (input.replaceScreenshots && patch.screenshots) {
      planScreenshots(
        patch.language,
        baseListing,
        patch.screenshots,
        input,
        changes,
        uploads,
      );
    }
  }

  if (input.packageFile) {
    const existing = submission.applicationPackages;
    const reference = existing[0];
    for (const pkg of existing) {
      if (pkg.fileStatus !== "PendingDelete") {
        changes.push({
          scope: "package",
          field: pkg.fileName,
          kind: "delete",
        });
        pkg.fileStatus = "PendingDelete";
      }
    }
    existing.push({
      fileName: input.packageFile.name,
      fileStatus: "PendingUpload",
      // 必須の項目は、既存のパッケージから引き継ぐ。
      minimumDirectXVersion: reference?.minimumDirectXVersion ?? "None",
      minimumSystemRam: reference?.minimumSystemRam ?? "None",
    });
    uploads.push({
      name: input.packageFile.name,
      data: input.packageFile.data,
    });
    changes.push({
      scope: "package",
      field: input.packageFile.name,
      kind: "add",
    });
  }

  return { submission, changes, uploads };
}

/** ジョブの要約（GitHub の Step Summary）に出す、差分の Markdown。 */
export function describePlan(plan: SubmissionPlan): string {
  if (plan.changes.length === 0) return "変更はありません。";
  const lines = [
    "| 対象 | 項目 | 操作 | 変更前 | 変更後 |",
    "| --- | --- | --- | --- | --- |",
  ];
  const cell = (value: string | undefined) =>
    (value ?? "").replaceAll("|", "\\|");
  for (const c of plan.changes) {
    lines.push(
      `| ${cell(c.scope)} | ${cell(c.field)} | ${c.kind} | ${cell(c.before)} | ${cell(c.after)} |`,
    );
  }
  return lines.join("\n");
}
