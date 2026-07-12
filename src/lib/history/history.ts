// history.ts — 編集区切り(undoグループ境界相当)の自動検出とスナップショット判定(SPEC.md §4.3 ★核心機能)
//
// 「完璧な検出は不要」(SPEC.md)という設計方針に基づき、CM6の内部undoグループAPIには
// 依存せず、アイドル/blur/visibilitychange/pagehide/paste/変更量閾値というOR条件の
// 代理シグナルで近似する。判定ロジックはこの純粋関数に集約し、実際のタイマー/
// イベント配線はUI層(useSnapshotScheduler.ts)が担う。

/** 最短フロア: この時間内は二重にスナップショットを刻まない(§4.3)。 */
export const MIN_FLOOR_MS = 5_000;
/** 最長キャップ: アクティブ編集中でも最低この頻度で強制的に刻む(§4.3)。
 * アイドル保存を5分に延ばした(ユーザー指示)のに合わせ、連続編集中の刻みも5分に揃える。 */
export const MAX_CAP_MS = 300_000;
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
  if (currentContent.trim() === "") return false; // 空ノートは保存対象にしない(ユーザー指示)
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

/** 「全選択からの削除」等の大量削除か——消える前の内容を即座に保存すべき局面かを判定する。
 * 非空→空(＝全選択して削除)、または閾値以上の一括削除でtrue(ユーザー指示: アイドル保存を
 * 5分に延ばしたため、削除で直近の内容が履歴から失われないようにする安全網)。 */
export function isLargeDeletion(prevContent: string, currentContent: string): boolean {
  if (prevContent.length > 0 && currentContent.length === 0) return true;
  return prevContent.length - currentContent.length >= CHANGE_THRESHOLD_CHARS;
}

/** 最長キャップを超えて久しく刻んでいないか(アクティブ編集中の安全網)。 */
export function exceedsMaxCap(now: number, lastSnapshotAt: number | null): boolean {
  if (lastSnapshotAt === null) return false;
  return now - lastSnapshotAt >= MAX_CAP_MS;
}

/** 履歴一覧の一文サマリの最大長(超えたら省略記号)。 */
export const SUMMARY_MAX_CHARS = 60;

function firstNonEmptyLine(text: string): string {
  for (const line of text.split("\n")) {
    if (line.trim() !== "") return line.trim();
  }
  return "";
}

/** currentとpreviousで最初に異なる行(current側)を返す。差が無ければnull。 */
function firstChangedLine(current: string, previous: string): string | null {
  const cur = current.split("\n");
  const prev = previous.split("\n");
  const n = Math.max(cur.length, prev.length);
  for (let i = 0; i < n; i++) {
    const c = cur[i] ?? "";
    const p = prev[i] ?? "";
    if (c !== p) {
      // 追加/変更ならcurrent側の行、純粋な削除(current側が空)ならprevious側を「(削除)」付きで示す。
      return c.trim() !== "" ? c.trim() : `(削除) ${p.trim()}`;
    }
  }
  return null;
}

/**
 * 履歴一覧に出す「一文サマリ」を算出する(SPEC.md §4.3 履歴の視認性)。
 * 前回スナップショットからの変更箇所(最初に異なる行)を優先し、無ければ本文の最初の行を返す。
 * 空白は畳み、長すぎる場合は省略する(一覧で1行に収める)。
 */
export function summarizeSnapshot(current: string, previous: string | null): string {
  const raw =
    (previous !== null ? firstChangedLine(current, previous) : null) ?? firstNonEmptyLine(current);
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed === "") return "(空)";
  return collapsed.length > SUMMARY_MAX_CHARS
    ? `${collapsed.slice(0, SUMMARY_MAX_CHARS)}…`
    : collapsed;
}
