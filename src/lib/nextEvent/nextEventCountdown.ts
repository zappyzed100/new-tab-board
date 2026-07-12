// nextEventCountdown.ts — 次の予定までのカウントダウン表示ロジック(純関数。SPEC.md §4.9)
// APIはポーリング(background.ts)のみ・カウントダウンの再計算はローカル時計で毎秒/毎分行う。
export type CountdownState =
  | { kind: "none" }
  | { kind: "in-progress" }
  | {
      kind: "upcoming";
      days: number;
      hours: number;
      minutes: number;
      /** 予定の暦日がnowの暦日の翌日かどうか(単なる24時間以内判定とは異なる——
       * 例: 23時に2時間後の予定があれば翌日だが、まだ24時間経っていない)。 */
      isTomorrow: boolean;
      title: string;
    };

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function computeCountdown(
  cache: { title: string; startsAt: number } | null | undefined,
  now: number,
): CountdownState {
  if (!cache) return { kind: "none" };
  const diffMs = cache.startsAt - now;
  if (diffMs <= 0) return { kind: "in-progress" };

  const totalMinutes = Math.ceil(diffMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const dayDiff = Math.round((startOfDay(cache.startsAt) - startOfDay(now)) / 86_400_000);

  return {
    kind: "upcoming",
    days,
    hours,
    minutes,
    isTomorrow: dayDiff === 1,
    title: cache.title,
  };
}

/** カウントダウンの表示文字列を組み立てる(例: "2時間15分"・"1日3時間0分(明日)")。 */
export function formatCountdown(state: Extract<CountdownState, { kind: "upcoming" }>): string {
  const segments: string[] = [];
  if (state.days > 0) segments.push(`${state.days}日`);
  if (state.days > 0 || state.hours > 0) segments.push(`${state.hours}時間`);
  segments.push(`${state.minutes}分`);
  return segments.join("") + (state.isTomorrow ? "(明日)" : "");
}
