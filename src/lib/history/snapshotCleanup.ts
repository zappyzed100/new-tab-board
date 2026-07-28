// snapshotCleanup.ts — 溜まってしまった重複スナップショットの掃除(明示操作のメンテナンス)
//
// 2026-07-25以前は「ペインがマウントしただけ」でスナップショットが1件保存されていたため
// (useSnapshotScheduler のヘッダー参照)、無編集のまま同一内容が大量に積まれている。原因側は
// 直したが**既に溜まった分は消えない**——溜まった件数に比例して転置索引の refs 配列が伸び、
// 1件の保存が重くなり続けるので、ここで一度だけ畳む。
import {
  deleteIndexEntry,
  deleteSnapshot,
  getAllIndexEntries,
  getAllSnapshots,
  putIndexEntry,
} from "../storage/db";
import { logOp } from "../runtime/log";
import type { Snapshot } from "../../types";

export type SnapshotDedupPlan = {
  /** 残すスナップショットid。 */
  keep: string[];
  /** 直前に残したものと内容が同じで、消してよいスナップショットid。 */
  remove: string[];
};

/** 比較キー。新しい実装が書く contentHash を優先し、無ければ圧縮済み本文をそのまま比べる
 * (gzipは同じ入力なら同じ出力なので、これで古いスナップショット同士も比較できる)。
 * どちらも無い(=NASへ排出済みで手元に本体が無い)なら null を返し、**消さない側へ倒す**。 */
function dedupKey(snapshot: Snapshot): string | null {
  if (snapshot.archived) return null; // 本体はNAS。比較できないので触らない
  if (snapshot.contentHash) return `h:${snapshot.contentHash}`;
  if (snapshot.content) return `c:${snapshot.content}`;
  return null;
}

/** 同じノートの中で「直前に残したものと内容が同じ」スナップショットを間引く計画を立てる(純粋)。
 *
 * 残すのは連続する同一内容の**最初の1件**——その内容が生まれた時刻を保つため。
 * A→B→A と戻った履歴では両方のAを残す(連続していないので別の出来事として扱う)。
 * 比較できないもの(archived / 本文なし)は常に残す。 */
export function planSnapshotDedup(snapshots: Snapshot[]): SnapshotDedupPlan {
  const byNote = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const list = byNote.get(s.noteId);
    if (list) list.push(s);
    else byNote.set(s.noteId, [s]);
  }
  const keep: string[] = [];
  const remove: string[] = [];
  for (const list of byNote.values()) {
    // 同じtimestampが並ぶことがある(同一tickの多重保存)ため、idで安定させる。
    const ordered = [...list].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    let lastKeptKey: string | null = null;
    for (const s of ordered) {
      const key = dedupKey(s);
      if (key !== null && key === lastKeptKey) {
        remove.push(s.id);
        continue;
      }
      keep.push(s.id);
      lastKeptKey = key;
    }
  }
  return { keep, remove };
}

/** 転置索引から、消したスナップショットidの参照を取り除いた結果を返す(純粋)。
 * refs が空になったトークンは索引ごと消す対象として tokensToDelete へ入れる。 */
export function pruneIndexRefs(
  entries: { token: string; refs: string[] }[],
  removedIds: ReadonlySet<string>,
): { updated: { token: string; refs: string[] }[]; tokensToDelete: string[] } {
  const updated: { token: string; refs: string[] }[] = [];
  const tokensToDelete: string[] = [];
  for (const entry of entries) {
    const refs = entry.refs.filter((id) => !removedIds.has(id));
    if (refs.length === entry.refs.length) continue; // 変化なし——書き戻さない
    if (refs.length === 0) tokensToDelete.push(entry.token);
    else updated.push({ token: entry.token, refs });
  }
  return { updated, tokensToDelete };
}

export type SnapshotCleanupResult = {
  scanned: number;
  removed: number;
  /** refs を書き換えた索引トークン数 + 消したトークン数。 */
  indexTokensTouched: number;
};

/** 重複スナップショットを実際に削除し、転置索引からも参照を取り除く。
 * 履歴を消す操作なので、呼び出し側(DataPanel)で明示の確認を取ってから呼ぶこと。 */
export async function dedupeStoredSnapshots(): Promise<SnapshotCleanupResult> {
  const snapshots = await getAllSnapshots();
  const { remove } = planSnapshotDedup(snapshots);
  if (remove.length === 0) {
    logOp("history", "cleanup", `scanned=${snapshots.length} removed=0 (重複なし)`);
    return { scanned: snapshots.length, removed: 0, indexTokensTouched: 0 };
  }
  const removedIds = new Set(remove);
  for (const id of remove) await deleteSnapshot(id);
  // 索引を放置すると refs が伸びたままで、重さの本体(1件あたりの書き戻し量)が減らない。
  const { updated, tokensToDelete } = pruneIndexRefs(await getAllIndexEntries(), removedIds);
  for (const entry of updated) await putIndexEntry(entry);
  for (const token of tokensToDelete) await deleteIndexEntry(token);
  const indexTokensTouched = updated.length + tokensToDelete.length;
  logOp(
    "history",
    "cleanup",
    `scanned=${snapshots.length} removed=${remove.length} indexTokens=${indexTokensTouched}`,
  );
  return { scanned: snapshots.length, removed: remove.length, indexTokensTouched };
}
