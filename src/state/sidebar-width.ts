/**
 * サイドバー幅の範囲と刻み（design-decisions.md 10.2）。
 *
 * 既定値の正本は `src-tauri/src/settings.rs` の `DEFAULT_SIDEBAR_WIDTH` とする。
 * 範囲と刻みはUIの関心事のため、こちらを正本とする。
 */

/** 最小幅（px）。これより狭いとツリーのインデントとファイル名が読めなくなる。 */
export const MIN_SIDEBAR_WIDTH = 200;

/** 最大幅（px）。ファイル名を読むのに十分な幅を超えて広がらないようにする。 */
export const MAX_SIDEBAR_WIDTH = 600;

/**
 * ウィンドウ幅に対して占めてよい割合の上限。
 *
 * 幅の狭いウィンドウで本文が潰れるのを防ぐ。800 pxのウィンドウで600 pxのサイドバーを
 * 許すと、本文は200 pxしか残らない。
 */
export const MAX_SIDEBAR_RATIO = 0.5;

/** 左右キー1回あたりの変化量（px）。 */
export const SIDEBAR_WIDTH_STEP = 16;

/** `Shift` 併用時の変化量（px）。範囲の端から端まで数回で移動できる大きさとする。 */
export const SIDEBAR_WIDTH_COARSE_STEP = 64;

/**
 * そのウィンドウ幅で実際に許される最大幅を返す。
 *
 * 割合による上限が最小幅を下回る場合は最小幅を返す。極端に狭いウィンドウでも
 * サイドバーを操作できない状態にしないためである。ウィンドウが最小幅の2倍に満たない
 * ときは、この分岐によって本文より広いサイドバーを許すことになるが、そこまで狭い
 * ウィンドウでは何を選んでも本文は読めない。
 */
export function effectiveMaxSidebarWidth(windowWidth: number): number {
  const byRatio = Math.floor(windowWidth * MAX_SIDEBAR_RATIO);
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, byRatio));
}

/**
 * 保存された幅を、そのウィンドウ幅で表示できる値へ収める。
 *
 * 収めた結果は表示にだけ使い、設定へは書き戻さない。ウィンドウを広げ直したときに
 * 元の幅へ復帰させるためである（design-decisions.md 10.2）。
 *
 * 有限の数でない値（設定ファイルが手で編集された場合など）は既定値の判断を
 * 呼び出し側へ委ねず、最小幅として扱う。
 */
export function clampSidebarWidth(
  savedWidth: number,
  windowWidth: number,
): number {
  if (!Number.isFinite(savedWidth)) {
    return MIN_SIDEBAR_WIDTH;
  }
  const max = effectiveMaxSidebarWidth(windowWidth);
  return Math.min(max, Math.max(MIN_SIDEBAR_WIDTH, Math.round(savedWidth)));
}

/**
 * キー操作による次の幅を返す。
 *
 * `direction` は広げる方向を正とする。`coarse` は `Shift` 併用を表す。
 */
export function nextSidebarWidth(
  currentWidth: number,
  direction: 1 | -1,
  windowWidth: number,
  coarse = false,
): number {
  const step = coarse ? SIDEBAR_WIDTH_COARSE_STEP : SIDEBAR_WIDTH_STEP;
  return clampSidebarWidth(currentWidth + direction * step, windowWidth);
}
