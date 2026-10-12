// 統合した日別の利用統計（`merged.csv`）から、人が見る概観の Markdown（`overview.md`）を作る。
//
// 日別の値を含むので、非公開の Dropbox にだけ置く（公開のログ・artifact・Step Summary には出さない）。
// md-peruse で開いて確かめる想定で、表と Mermaid のグラフ（`xychart-beta`）だけを使う。
//
// 全体の値は、SubscriptionName・DeviceType・Market がすべて `All` の行を使う（個別の行も足すと、
// 同じセッションを何重にも数える）。その中で、PackageVersion が `All` の行が全版の合計、
// それ以外が版別の値になる。

import type { UsageRow, UsageTable } from "./usage-merged";

const ALL = "All";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OverviewOptions {
  /** 概観を作った時刻。 */
  generatedAt: Date;
  /** 表とグラフに出す、直近の日数（最新の日付を末尾とする暦日）。 */
  days?: number;
}

const isOverall = (row: UsageRow) =>
  row.SubscriptionName === ALL && row.DeviceType === ALL && row.Market === ALL;

const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/** 表示用の数値。空・数値でない値は `-`。 */
function show(value: string | undefined): string {
  if (value === undefined || value === "" || Number.isNaN(Number(value))) {
    return "-";
  }
  return String(Number(value));
}

/** グラフ用の数値。空・数値でない値は 0。 */
const num = (value: string | undefined): number => {
  const n = Number(value);
  return value === undefined || value === "" || Number.isNaN(n) ? 0 : n;
};

function chart(
  title: string,
  axisLabel: string,
  labels: string[],
  kind: "bar" | "line",
  values: number[],
): string[] {
  const max = Math.max(1, ...values);
  return [
    "```mermaid",
    "xychart-beta",
    `    title "${title}"`,
    `    x-axis [${labels.map((l) => `"${l}"`).join(", ")}]`,
    `    y-axis "${axisLabel}" 0 --> ${Math.ceil(max * 1.2)}`,
    `    ${kind} [${values.join(", ")}]`,
    "```",
  ];
}

export function renderOverview(
  table: UsageTable,
  options: OverviewOptions,
): string {
  const days = options.days ?? 30;
  const overall = table.rows.filter(isOverall);
  const total = new Map(
    overall.filter((row) => row.PackageVersion === ALL).map((r) => [r.Date, r]),
  );
  const header = [
    "# 日別の利用統計の概観",
    "",
    `作成: ${options.generatedAt.toISOString()}（Partner Center の Insights API の \`UsageDaily\`。統合した CSV から自動で生成した。手で編集しない）`,
    "",
  ];
  if (total.size === 0) {
    return [
      ...header,
      "全体の集計行（SubscriptionName・DeviceType・Market・PackageVersion がすべて `All`）がまだありません。",
      "",
    ].join("\n");
  }

  const dates = [...total.keys()].sort();
  const first = dates[0] as string;
  const latest = dates[dates.length - 1] as string;

  // 直近の `days` 日（最新の日付を末尾とする暦日）。行の無い日は、グラフでは 0、表では出さない。
  const windowStart = Math.max(
    toTime(first),
    toTime(latest) - (days - 1) * DAY_MS,
  );
  const window: string[] = [];
  for (let t = windowStart; t <= toTime(latest); t += DAY_MS) {
    window.push(toDate(t));
  }
  const inWindow = window.filter((date) => total.has(date));
  const rowOf = (date: string) => total.get(date) as UsageRow;

  const latestRow = rowOf(latest);
  const sessionsInWindow = inWindow.reduce(
    (sum, date) => sum + num(rowOf(date).DailySessionCount),
    0,
  );

  const lines = [
    ...header,
    "## 要約",
    "",
    "| 項目 | 値 |",
    "| --- | --- |",
    `| データの期間 | ${first} 〜 ${latest}（行がある日: ${total.size} 日） |`,
    `| 最新の日付 | ${latest}（Insights のデータは、約 2 日遅れで届く） |`,
    `| 最新日の DAU（日次のアクティブユーザー） | ${show(latestRow.DailyActiveUsers)} |`,
    `| 最新日の MAU（月次のアクティブユーザー） | ${show(latestRow.MonthlyActiveUsers)} |`,
    `| 直近 ${window.length} 日のセッション合計 | ${sessionsInWindow} |`,
    "",
    `## 日別（直近 ${window.length} 日。新しい順）`,
    "",
    "| 日付 | セッション | 利用時間（分） | DAU | DAD | 新規ユーザー | MAU |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...[...inWindow].reverse().map((date) => {
      const r = rowOf(date);
      return `| ${date} | ${show(r.DailySessionCount)} | ${show(r.EngagementDurationMinutes)} | ${show(r.DailyActiveUsers)} | ${show(r.DailyActiveDevices)} | ${show(r.DailyNewUsers)} | ${show(r.MonthlyActiveUsers)} |`;
    }),
    "",
    "DAU・MAU は、その日（月）の値で、日をまたいで足せない。行の無い日は、表に出さない（グラフでは 0）。",
    "",
  ];

  const labels = window.map((date) => date.slice(5));
  const series = (column: string) =>
    window.map((date) => num(total.get(date)?.[column]));
  lines.push(
    "## グラフ",
    "",
    ...chart(
      `日別セッション数（直近 ${window.length} 日）`,
      "セッション",
      labels,
      "bar",
      series("DailySessionCount"),
    ),
    "",
    ...chart(
      `日別 DAU（直近 ${window.length} 日）`,
      "DAU",
      labels,
      "line",
      series("DailyActiveUsers"),
    ),
    "",
  );

  // 版別: 全体の集計行のうち、PackageVersion が `All` でない行。
  const versions = new Map<string, UsageRow[]>();
  for (const row of overall) {
    if (row.PackageVersion === ALL) continue;
    versions.set(row.PackageVersion ?? "", [
      ...(versions.get(row.PackageVersion ?? "") ?? []),
      row,
    ]);
  }
  lines.push("## 版別", "");
  if (versions.size === 0) {
    lines.push("版別の行がまだありません。", "");
  } else {
    lines.push(
      "| PackageVersion | 初日 | 最終日 | 行がある日 | セッション合計 |",
      "| --- | --- | --- | --- | --- |",
      ...[...versions.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([version, rows]) => {
          const vDates = rows.map((r) => r.Date ?? "").sort();
          const sessions = rows.reduce(
            (sum, r) => sum + num(r.DailySessionCount),
            0,
          );
          return `| ${version === "" ? "（空）" : version} | ${vDates[0]} | ${vDates[vDates.length - 1]} | ${rows.length} | ${sessions} |`;
        }),
      "",
    );
  }

  // データの欠け: 全期間で、全体の集計行が無い日。
  const missing: string[] = [];
  for (let t = toTime(first); t <= toTime(latest); t += DAY_MS) {
    const date = toDate(t);
    if (!total.has(date)) missing.push(date);
  }
  lines.push("## 行が無い日", "");
  if (missing.length === 0) {
    lines.push(`${first} 〜 ${latest} の全ての日に、行があります。`, "");
  } else {
    lines.push(
      "利用が無かった日と、取得の欠けは、この表からは区別できない（Insights は、利用が無い日の行を返さない）。",
      "取得の欠けを疑うなら、`snapshots/` の生スナップショットで、その日が含まれる期間を確かめる。",
      "",
      ...missing.map((date) => `- ${date}`),
      "",
    );
  }
  return lines.join("\n");
}
