// nextEventCountdown.ts — 次の予定までのカウントダウン表示ロジック(純関数。SPEC.md §4.9)
// APIはポーリング(background.ts)のみ・カウントダウンの再計算はローカル時計で毎秒/毎分行う。
export type CountdownState =
  { kind: "none" } | { kind: "in-progress" } | { kind: "upcoming"; minutes: number; title: string };

export function computeCountdown(
  cache: { title: string; startsAt: number } | null | undefined,
  now: number,
): CountdownState {
  if (!cache) return { kind: "none" };
  const diffMs = cache.startsAt - now;
  if (diffMs <= 0) return { kind: "in-progress" };
  return { kind: "upcoming", minutes: Math.ceil(diffMs / 60_000), title: cache.title };
}
