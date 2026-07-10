// preEventAlarm.ts — 予定前アラームのスケジュール計算(純関数。SPEC.md §4.11)
const MINUTES_BEFORE = 10;

/** 「開始-10分」のアラーム発火時刻を返す。既に始まっている予定はnull(アラーム不要)。
 * 初認識時点で残り10分未満なら、既に過ぎた発火時刻をnowへ繰り上げて即時発火扱いにする
 * (SPEC.md §4.11エッジケース「初認識時点で残り10分未満なら即時発火」)。 */
export function resolveAlarmTime(startsAt: number, now: number): number | null {
  if (startsAt <= now) return null;
  const alarmTime = startsAt - MINUTES_BEFORE * 60_000;
  return Math.max(alarmTime, now);
}
