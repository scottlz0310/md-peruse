/**
 * プレビュー本文の文字サイズの段階（design-decisions.md 10.3）。
 *
 * 既定値の正本は `src-tauri/src/settings.rs` の `DEFAULT_FONT_SCALE_PERCENT` とする。
 * 段階の並びはUIの関心事のため、こちらを正本とする。
 */

/**
 * 選べる倍率（%）。小さい順に並べる。
 *
 * 等間隔ではなく、大きい側ほど粗く刻む。人の知覚は相対変化に反応するため、
 * 150 %から160 %への変化はほとんど見分けられない。ブラウザのズームと同じ感覚で使え、
 * 端から端まで7回の操作で移動できる。
 */
export const FONT_SCALE_STEPS = [80, 90, 100, 110, 125, 150, 175, 200] as const;

export type FontScalePercent = (typeof FONT_SCALE_STEPS)[number];

/**
 * 任意の値を段階のいずれかへ丸める。
 *
 * 設定ファイルが手で編集された場合や、段階の並びを変えた後に古い設定を読んだ場合に、
 * 段階のどれにも一致しない値が入りうる。最も近い段階を選び、等距離のときは小さいほうを
 * 選ぶ。読みやすさを損なう側へ倒さないためである。
 */
export function normalizeFontScale(percent: number): FontScalePercent {
  if (!Number.isFinite(percent)) {
    return 100;
  }
  let nearest: FontScalePercent = FONT_SCALE_STEPS[0];
  let smallestDistance = Number.POSITIVE_INFINITY;
  for (const step of FONT_SCALE_STEPS) {
    const distance = Math.abs(step - percent);
    if (distance < smallestDistance) {
      nearest = step;
      smallestDistance = distance;
    }
  }
  return nearest;
}

/**
 * 段階を `offset` だけ移動した倍率を返す。範囲外へは出ない。
 *
 * 添字は段階の範囲へ収めてから引くため必ず値が得られるが、`noUncheckedIndexedAccess`
 * の下では省略できないため、到達しない側を現在値で埋める。
 */
function shiftFontScale(percent: number, offset: number): FontScalePercent {
  const current = normalizeFontScale(percent);
  const index = FONT_SCALE_STEPS.indexOf(current);
  const shifted = Math.min(
    Math.max(index + offset, 0),
    FONT_SCALE_STEPS.length - 1,
  );
  return FONT_SCALE_STEPS[shifted] ?? current;
}

/** 1段階大きい倍率を返す。最大のときはそのまま返す。 */
export function increaseFontScale(percent: number): FontScalePercent {
  return shiftFontScale(percent, 1);
}

/** 1段階小さい倍率を返す。最小のときはそのまま返す。 */
export function decreaseFontScale(percent: number): FontScalePercent {
  return shiftFontScale(percent, -1);
}
