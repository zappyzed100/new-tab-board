// diff.ts — 2つのスナップショット本文の差分を表示時に算出する(保存は常にフル。SPEC.md §4.3)
import DiffMatchPatch from "diff-match-patch";

export type DiffPart = { type: "equal" | "insert" | "delete"; text: string };

const dmp = new DiffMatchPatch();

export function computeDiff(before: string, after: string): DiffPart[] {
  const diffs = dmp.diff_main(before, after);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, text]) => ({
    type: op === 1 ? "insert" : op === -1 ? "delete" : "equal",
    text,
  }));
}
