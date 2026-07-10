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
