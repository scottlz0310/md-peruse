// 繰り返しレポートの健全性: 古さの検出と、終了前の警告。
//
// 繰り返しレポートには回数の上限がある（Daily 180 回、Weekly 52 回、Monthly 24 回）。使い切ると、新しい
// 実行は積まれなくなる。気づかないまま日が経つと、データに欠けが出る（各実行は直近 30 日分を含むので、
// 30 日以内に作り直せば、欠けは出ない）。次の 2 つで、早めに気づけるようにする。
//
// 1. 古さ: 最新の完了した実行の生成時刻が、`STALE_AFTER_DAYS` 日より前なら、日次のジョブを失敗させる
//    （GitHub の失敗の通知で気づく）。週次の実行は、通常 7 日以内に新しい実行がある。
// 2. 終了前: レポートの終了予定（`endTime`）まで、残り `EXPIRY_WARNING_DAYS` 日を切ったら、警告を出す
//    （失敗にはしない。概観・Step Summary・Actions の注釈に出す）。
//
// どちらも、実行の一覧の応答の項目（`reportGeneratedTime`・`endTime`）から計算する。追加の API は要らない。

export const STALE_AFTER_DAYS = 10;
export const EXPIRY_WARNING_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ReportHealth {
  /** 最新の完了した実行の生成時刻。 */
  generatedTime: string;
  /** 生成から現在までの日数（切り捨て）。 */
  ageDays: number;
  stale: boolean;
  /** レポートの終了予定。応答に無い・読めないときは undefined。 */
  endTime?: string;
  /** 終了予定までの日数（切り捨て。過ぎていれば負）。 */
  remainingDays?: number;
  expiringSoon: boolean;
}

export function assessReport(
  item: { reportGeneratedTime: string; endTime?: string | null },
  now: Date,
): ReportHealth {
  const age = (now.getTime() - Date.parse(item.reportGeneratedTime)) / DAY_MS;
  const end = item.endTime ? Date.parse(item.endTime) : Number.NaN;
  const remaining = (end - now.getTime()) / DAY_MS;
  const known = !Number.isNaN(remaining);
  return {
    generatedTime: item.reportGeneratedTime,
    ageDays: Math.floor(age),
    stale: age > STALE_AFTER_DAYS,
    endTime: known ? (item.endTime as string) : undefined,
    remainingDays: known ? Math.floor(remaining) : undefined,
    expiringSoon: known && remaining < EXPIRY_WARNING_DAYS,
  };
}

const RECREATE =
  "Store Insights の mode=usage-schedule で、繰り返しレポートを作り直し、リポジトリの変数 STORE_USAGE_REPORT_ID を新しい reportId に更新してください";

export function staleMessage(health: ReportHealth): string {
  return `最新の完了した実行（${health.generatedTime}）が ${health.ageDays} 日前です（${STALE_AFTER_DAYS} 日を超えています）。繰り返しレポートが終了した、または止まっている可能性があります。Store Insights の mode=usage-status で状態を確かめ、必要なら ${RECREATE}`;
}

export function expiryMessage(health: ReportHealth): string {
  const remaining = health.remainingDays ?? 0;
  const when =
    remaining < 0
      ? `繰り返しレポートの終了予定（${health.endTime}）を過ぎています`
      : `繰り返しレポートの終了予定（${health.endTime}）まで、残り ${remaining} 日です`;
  return `${when}。データに欠けが出る前に（各実行は直近 30 日分を含む）、${RECREATE}`;
}

/** 警告（失敗にはしない）と、失敗にする理由。 */
export function describeHealth(health: ReportHealth): {
  warnings: string[];
  failure?: string;
} {
  return {
    warnings: health.expiringSoon ? [expiryMessage(health)] : [],
    failure: health.stale ? staleMessage(health) : undefined,
  };
}

/** 終了予定の表記（概観と Step Summary で共通）。 */
export function describeEndTime(health: ReportHealth): string {
  if (health.endTime === undefined) return "不明（応答に無い）";
  const remaining = health.remainingDays ?? 0;
  return `${health.endTime}（${remaining < 0 ? "過ぎている" : `残り ${remaining} 日`}）`;
}

/** 失敗の理由と警告を、1 つの一覧にする（概観・Step Summary の「注意」の行）。 */
export function healthNotices(health: ReportHealth): string[] {
  const { warnings, failure } = describeHealth(health);
  return [...(failure ? [failure] : []), ...warnings];
}
