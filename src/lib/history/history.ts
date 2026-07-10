// history.ts — 編集区切り(undoグループ境界相当)の自動検出とスナップショット判定(SPEC.md §4.3 ★核心機能)
//
// 「完璧な検出は不要」(SPEC.md)という設計方針に基づき、CM6の内部undoグループAPIには
// 依存せず、アイドル/blur/visibilitychange/pagehide/paste/変更量閾値というOR条件の
// 代理シグナルで近似する。判定ロジックはこの純粋関数に集約し、実際のタイマー/
// イベント配線はUI層(useSnapshotScheduler.ts)が担う。

/** 最短フロア: この時間内は二重にスナップショットを刻まない(§4.3)。 */
export const MIN_FLOOR_MS = 5_000;
/** 最長キャップ: アクティブ編集中でも最低この頻度で強制的に刻む(§4.3)。 */
export const MAX_CAP_MS = 60_000;
/** 変更量の閾値: 前回スナップショットからこの文字数を超えたら安全網として刻む(§4.3)。 */
export const CHANGE_THRESHOLD_CHARS = 200;

export type SnapshotGateInput = {
  now: number;
  lastSnapshotAt: number | null;
  lastContent: string | null;
  currentContent: string;
};

/**
 * dedup(内容不変ならスキップ) + 最短フロアのガードを適用し、
 * いま実際にスナップショットを刻んでよいかを判定する。
 */
export function shouldSnapshot(input: SnapshotGateInput): boolean {
  const { now, lastSnapshotAt, lastContent, currentContent } = input;
  if (currentContent === lastContent) return false;
  if (lastSnapshotAt !== null && now - lastSnapshotAt < MIN_FLOOR_MS) return false;
  return true;
}

/** 前回スナップショットからの変更量(文字数の絶対差)が閾値を超えたか。 */
export function exceedsChangeThreshold(
  lastContent: string | null,
  currentContent: string,
): boolean {
  const diff = Math.abs(currentContent.length - (lastContent?.length ?? 0));
  return diff >= CHANGE_THRESHOLD_CHARS;
}

/** 最長キャップを超えて久しく刻んでいないか(アクティブ編集中の安全網)。 */
export function exceedsMaxCap(now: number, lastSnapshotAt: number | null): boolean {
  if (lastSnapshotAt === null) return false;
  return now - lastSnapshotAt >= MAX_CAP_MS;
}
