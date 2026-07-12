// noteFont.ts — ノート本文(エディタ)の文字サイズ(px)の既定値・範囲・クランプ。
// A-/A+ で一括調整する表示設定(ユーザー指示)。ノート以外のUI文字には影響させない。
export const NOTE_FONT_DEFAULT = 13;
export const NOTE_FONT_MIN = 10;
export const NOTE_FONT_MAX = 28;
export const NOTE_FONT_STEP = 1;

/** 文字サイズを許容範囲[MIN, MAX]へ丸める。NaNや未設定相当は既定値へ倒す。 */
export function clampNoteFontSize(px: number): number {
  if (!Number.isFinite(px)) return NOTE_FONT_DEFAULT;
  return Math.min(NOTE_FONT_MAX, Math.max(NOTE_FONT_MIN, Math.round(px)));
}
