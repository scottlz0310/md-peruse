// 申請の内容が、掲載情報（CSV）のとおりかを照合する（読み取りだけ。証跡のための検査）。
//
// API で行った変更は、Partner Center の画面にすぐには反映されない（PUT の応答の画像は `PendingUpload`
// で、commit の後の取り込みで `Uploaded` と ID になる）。画面の見え方に頼らず、API が返す申請の JSON を、
// CSV と突き合わせて、取り込みと反映を、証跡で確かめる。

import { type ListingPatch, TEXT_FIELDS } from "./listing";
import type { StoreImage, StoreSubmission } from "./plan";

export interface CheckResult {
  /** 言語（`en-us` など）。 */
  scope: string;
  /** 検査の名前（`screenshot の順序` など）。 */
  check: string;
  ok: boolean;
  expected: string;
  actual: string;
}

function short(value: string, length = 70): string {
  const flat = value.replaceAll("\r\n", "↵").replaceAll("\n", "↵");
  return flat.length > length
    ? `${flat.slice(0, length)}…（${value.length}字）`
    : flat;
}

/** パスの最後の要素（`store/a.png` → `a.png`、`images/en-us/01-a.png` → `01-a.png`）。 */
function lastSegment(path: string): string {
  return path.split("/").pop() ?? path;
}

function summarizeStatuses(images: StoreImage[]): string {
  const counts = new Map<string, number>();
  for (const image of images) {
    counts.set(image.fileStatus, (counts.get(image.fileStatus) ?? 0) + 1);
  }
  return counts.size === 0
    ? "なし"
    : [...counts].map(([status, count]) => `${status}×${count}`).join("、");
}

function verifyScreenshots(
  scope: string,
  images: StoreImage[],
  patch: ListingPatch,
): CheckResult[] {
  const screenshots = patch.screenshots ?? [];
  const live = images.filter(
    (image) =>
      image.imageType === "Screenshot" && image.fileStatus !== "PendingDelete",
  );
  const pendingDelete = images.filter(
    (image) =>
      image.imageType === "Screenshot" && image.fileStatus === "PendingDelete",
  );
  const expectedDescriptions = screenshots.map((s) => s.description);
  const actualDescriptions = live.map((image) => image.description ?? "");

  return [
    {
      scope,
      check: "screenshot の枚数",
      ok: live.length === screenshots.length,
      expected: `${screenshots.length}`,
      actual: `${live.length}`,
    },
    {
      scope,
      check: "screenshot の順序と字幕",
      ok:
        JSON.stringify(expectedDescriptions) ===
        JSON.stringify(actualDescriptions),
      expected: expectedDescriptions
        .map((d, i) => `${i + 1}. ${short(d, 40)}`)
        .join(" / "),
      actual: actualDescriptions
        .map((d, i) => `${i + 1}. ${short(d, 40)}`)
        .join(" / "),
    },
    {
      scope,
      // 字幕が同じ画像（差し替えの前後）は、字幕では区別できない。ファイル名は、CSV の画像名で終わる。
      check: "screenshot のファイル名（CSV の画像名で終わる）",
      ok:
        live.length === screenshots.length &&
        screenshots.every((s, i) =>
          lastSegment(live[i]?.fileName ?? "").endsWith(lastSegment(s.path)),
        ),
      expected: screenshots.map((s) => lastSegment(s.path)).join(" / "),
      actual: live.map((image) => lastSegment(image.fileName)).join(" / "),
    },
    {
      scope,
      check: "screenshot の取り込み（すべて Uploaded で、ID がある）",
      ok:
        live.length > 0 &&
        live.every((i) => i.fileStatus === "Uploaded" && !!i.id),
      expected: `Uploaded×${screenshots.length}`,
      actual: summarizeStatuses(live),
    },
    {
      scope,
      check: "削除待ちの screenshot が残っていない",
      ok: pendingDelete.length === 0,
      expected: "0",
      actual: `${pendingDelete.length}`,
    },
  ];
}

/** 申請の内容を、掲載情報（言語ごとの `ListingPatch`）と照合する。CSV で指定した項目だけを見る。 */
export function verifyListing(
  submission: StoreSubmission,
  patches: ListingPatch[],
): CheckResult[] {
  const results: CheckResult[] = [];
  for (const patch of patches) {
    const scope = patch.language;
    const listing = submission.listings[scope];
    if (!listing) {
      results.push({
        scope,
        check: "掲載情報の言語",
        ok: false,
        expected: "あり",
        actual: "なし",
      });
      continue;
    }
    const base = listing.baseListing;

    for (const [, key] of TEXT_FIELDS) {
      const expected = patch.text[key];
      if (expected === undefined) continue;
      const actual = typeof base[key] === "string" ? (base[key] as string) : "";
      results.push({
        scope,
        check: `文章: ${key}`,
        ok: actual === expected,
        expected: short(expected),
        actual: short(actual),
      });
    }

    if (patch.features) {
      results.push({
        scope,
        check: "機能の一覧（features）",
        ok:
          JSON.stringify(base.features ?? []) ===
          JSON.stringify(patch.features),
        expected: `${patch.features.length}件`,
        actual: `${base.features?.length ?? 0}件`,
      });
    }
    if (patch.keywords) {
      results.push({
        scope,
        check: "検索語（keywords）",
        ok:
          JSON.stringify(base.keywords ?? []) ===
          JSON.stringify(patch.keywords),
        expected: patch.keywords.join(", "),
        actual: (base.keywords ?? []).join(", "),
      });
    }
    if (patch.screenshots) {
      results.push(...verifyScreenshots(scope, base.images ?? [], patch));
    }
  }
  return results;
}

/** 照合の結果を、Markdown の表にする（Step Summary とログ用）。 */
export function describeVerification(results: CheckResult[]): string {
  if (results.length === 0)
    return "照合する掲載情報（--listing）が指定されていません。";
  const cell = (value: string) => value.replaceAll("|", "\\|");
  const failed = results.filter((r) => !r.ok).length;
  const lines = [
    failed === 0
      ? `照合: ${results.length} 件すべて、掲載情報（CSV）のとおり`
      : `照合: ${results.length} 件のうち ${failed} 件が、掲載情報（CSV）と違う`,
    "",
    "| 結果 | 対象 | 検査 | 期待 | 実際 |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    lines.push(
      `| ${r.ok ? "✅" : "❌"} | ${cell(r.scope)} | ${cell(r.check)} | ${cell(r.expected)} | ${cell(r.actual)} |`,
    );
  }
  return lines.join("\n");
}

/**
 * 取り込みで、スクリーンショットが差し替わったかを、ID で確かめる。`replaced` の言語について、取り込みの後の
 * 画像の ID が、公開済みの申請の画像の ID と、すべて違うことを見る。字幕もファイル名も、ID と違って、
 * 差し替えの前後で同じになりうる（ファイル名は取り込みで書き換わるかもしれない）ので、ID で確かめる。
 */
export function verifyReplacement(
  before: StoreSubmission,
  after: StoreSubmission,
  replaced: string[],
): CheckResult[] {
  const idsOf = (submission: StoreSubmission, language: string) =>
    (submission.listings[language]?.baseListing.images ?? [])
      .filter(
        (image) =>
          image.imageType === "Screenshot" &&
          image.fileStatus !== "PendingDelete",
      )
      .map((image) => image.id)
      .filter((id): id is string => !!id);

  return replaced.map((scope) => {
    const oldIds = new Set(idsOf(before, scope));
    const newIds = idsOf(after, scope);
    const overlap = newIds.filter((id) => oldIds.has(id));
    return {
      scope,
      check:
        "screenshot が差し替わった（ID が、公開済みの画像の ID と、すべて違う）",
      ok: newIds.length > 0 && overlap.length === 0,
      expected: "公開済みの ID と重ならない",
      actual:
        newIds.length === 0
          ? "ID のある画像がない"
          : overlap.length === 0
            ? `新しい ID×${newIds.length}`
            : `重なる ID: ${overlap.length}/${newIds.length} 件`,
    };
  });
}
