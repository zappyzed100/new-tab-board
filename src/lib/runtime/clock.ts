// clock.ts — 時刻の唯一の入出口(GUARDRAILS.md §12.2)。テストや他ファイルから直接Date.now()を叩かない
declare global {
  interface Window {
    __TIME_FREEZE__?: number;
  }
}

export function now(): number {
  const frozen = typeof window !== "undefined" ? window.__TIME_FREEZE__ : undefined;
  return typeof frozen === "number" ? frozen : Date.now();
}

/** currentから見た次のintervalMs境界までのミリ秒数。setIntervalの固定間隔は実行遅延
 * (メインスレッド混雑・バックグラウンドタブでのスロットリング)でズレが蓄積するため、
 * 毎回このズレを実時刻から計算し直してsetTimeoutし直す(自己補正)用途に使う。 */
export function msUntilNextInterval(current: number, intervalMs: number): number {
  return intervalMs - (current % intervalMs);
}
