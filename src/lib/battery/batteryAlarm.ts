// batteryAlarm.ts — バッテリー低下アラームの閾値越え判定(純関数)。
// 10/20/50%のような降順閾値配列を受け取り、現在値が「まだ発火していない閾値」を
// 下回っていればそれらを返す。充電されて最高閾値を上回ったら発火済み記録をリセットする
// (再度下がってきたら同じ閾値をまた鳴らせるように——ユーザー指示: 10/20/50%で段階的に警告)。
export const DEFAULT_BATTERY_THRESHOLDS = [50, 20, 10]; // 降順(高い方から順に鳴らす)

export type BatteryAlarmDecision = {
  /** 今回新たに発火すべき閾値(降順)。空なら鳴らすものは無い。 */
  toFire: number[];
  /** 次回に持ち越す「発火済み」閾値の集合(呼び出し側が永続化する)。 */
  nextFired: number[];
};

/** level(現在のバッテリー%)とfiredThresholds(既に鳴らした閾値)から、今回鳴らすべき
 * 閾値を決める。最高閾値より充電が回復したら発火済み記録を丸ごとリセットする。 */
export function decideBatteryAlarm(
  level: number,
  firedThresholds: number[],
  thresholds: number[] = DEFAULT_BATTERY_THRESHOLDS,
): BatteryAlarmDecision {
  const sorted = [...thresholds].sort((a, b) => b - a);
  const highest = sorted[0] ?? 0;
  if (level > highest) {
    return { toFire: [], nextFired: [] }; // 十分回復=次に下がってきたらまた鳴らせる状態へ戻す
  }
  const already = new Set(firedThresholds);
  const toFire = sorted.filter((t) => level <= t && !already.has(t));
  const nextFired = [...new Set([...firedThresholds, ...toFire])];
  return { toFire, nextFired };
}
