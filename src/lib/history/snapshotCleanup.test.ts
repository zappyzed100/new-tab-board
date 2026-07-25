// snapshotCleanup.test.ts — 重複スナップショット掃除(計画の純粋関数 + 実DB操作)の単体テスト
import { describe, expect, it } from "vitest";
import { dedupeStoredSnapshots, planSnapshotDedup, pruneIndexRefs } from "./snapshotCleanup";
import { getAllIndexEntries, getSnapshotsByNote, putIndexEntry, putSnapshot } from "../storage/db";
import type { Snapshot } from "../../types";

function snap(over: Partial<Snapshot> & Pick<Snapshot, "id" | "noteId" | "timestamp">): Snapshot {
  return { archived: false, ...over };
}

describe("planSnapshotDedup", () => {
  it("連続する同一内容は最初の1件だけ残す(生まれた時刻を保つ)", () => {
    const plan = planSnapshotDedup([
      snap({ id: "a", noteId: "n1", timestamp: 1, contentHash: "x" }),
      snap({ id: "b", noteId: "n1", timestamp: 2, contentHash: "x" }),
      snap({ id: "c", noteId: "n1", timestamp: 3, contentHash: "x" }),
    ]);
    expect(plan.keep).toEqual(["a"]);
    expect(plan.remove).toEqual(["b", "c"]);
  });

  it("内容が変わっていれば残す", () => {
    const plan = planSnapshotDedup([
      snap({ id: "a", noteId: "n1", timestamp: 1, contentHash: "x" }),
      snap({ id: "b", noteId: "n1", timestamp: 2, contentHash: "y" }),
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("A→B→A と戻った履歴は両方のAを残す(連続していないので別の出来事)", () => {
    const plan = planSnapshotDedup([
      snap({ id: "a1", noteId: "n1", timestamp: 1, contentHash: "x" }),
      snap({ id: "b", noteId: "n1", timestamp: 2, contentHash: "y" }),
      snap({ id: "a2", noteId: "n1", timestamp: 3, contentHash: "x" }),
    ]);
    expect(plan.remove).toEqual([]);
    expect(plan.keep).toEqual(["a1", "b", "a2"]);
  });

  it("ノートをまたいで同じ内容でも消さない(比較は同じノートの中だけ)", () => {
    const plan = planSnapshotDedup([
      snap({ id: "a", noteId: "n1", timestamp: 1, contentHash: "x" }),
      snap({ id: "b", noteId: "n2", timestamp: 2, contentHash: "x" }),
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("時系列が前後して渡されても、timestamp順で判定する", () => {
    const plan = planSnapshotDedup([
      snap({ id: "late", noteId: "n1", timestamp: 9, contentHash: "x" }),
      snap({ id: "early", noteId: "n1", timestamp: 1, contentHash: "x" }),
    ]);
    expect(plan.keep).toEqual(["early"]);
    expect(plan.remove).toEqual(["late"]);
  });

  it("contentHashが無い古いスナップショットは圧縮済み本文で比較する", () => {
    const plan = planSnapshotDedup([
      snap({ id: "a", noteId: "n1", timestamp: 1, content: "GZIPPED" }),
      snap({ id: "b", noteId: "n1", timestamp: 2, content: "GZIPPED" }),
      snap({ id: "c", noteId: "n1", timestamp: 3, content: "OTHER" }),
    ]);
    expect(plan.remove).toEqual(["b"]);
  });

  it("NASへ排出済み(archived)は比較できないので常に残す", () => {
    const plan = planSnapshotDedup([
      snap({ id: "a", noteId: "n1", timestamp: 1, contentHash: "x" }),
      snap({ id: "arch1", noteId: "n1", timestamp: 2, archived: true, archivePath: "p1" }),
      snap({ id: "arch2", noteId: "n1", timestamp: 3, archived: true, archivePath: "p2" }),
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("本文もハッシュも無いものは消さない側へ倒す", () => {
    const plan = planSnapshotDedup([
      snap({ id: "a", noteId: "n1", timestamp: 1 }),
      snap({ id: "b", noteId: "n1", timestamp: 2 }),
    ]);
    expect(plan.remove).toEqual([]);
  });

  it("空入力なら何も残さず何も消さない", () => {
    expect(planSnapshotDedup([])).toEqual({ keep: [], remove: [] });
  });
});

describe("pruneIndexRefs", () => {
  it("消したidの参照だけを取り除く", () => {
    const { updated, tokensToDelete } = pruneIndexRefs(
      [{ token: "メモ", refs: ["s1", "s2", "s3"] }],
      new Set(["s2"]),
    );
    expect(updated).toEqual([{ token: "メモ", refs: ["s1", "s3"] }]);
    expect(tokensToDelete).toEqual([]);
  });

  it("refsが空になったトークンは索引ごと消す", () => {
    const { updated, tokensToDelete } = pruneIndexRefs(
      [{ token: "メモ", refs: ["s1"] }],
      new Set(["s1"]),
    );
    expect(updated).toEqual([]);
    expect(tokensToDelete).toEqual(["メモ"]);
  });

  it("変化の無いトークンは書き戻さない(無駄なIndexedDB書き込みを出さない)", () => {
    const { updated, tokensToDelete } = pruneIndexRefs(
      [{ token: "メモ", refs: ["s1"] }],
      new Set(["other"]),
    );
    expect(updated).toEqual([]);
    expect(tokensToDelete).toEqual([]);
  });
});

describe("dedupeStoredSnapshots(実DB)", () => {
  it("重複を実際に消し、転置索引の参照も落とす", async () => {
    for (const [id, ts, hash] of [
      ["c1", 1, "same"],
      ["c2", 2, "same"],
      ["c3", 3, "changed"],
    ] as const) {
      await putSnapshot({
        id,
        noteId: "cleanup-note",
        timestamp: ts,
        content: `body-${id}`,
        archived: false,
        contentHash: hash,
      });
    }
    await putIndexEntry({ token: "掃除トークン", refs: ["c1", "c2", "c3"] });
    await putIndexEntry({ token: "消えるトークン", refs: ["c2"] });

    const result = await dedupeStoredSnapshots();
    expect(result.removed).toBeGreaterThanOrEqual(1);

    const left = await getSnapshotsByNote("cleanup-note");
    expect(left.map((s) => s.id).sort()).toEqual(["c1", "c3"]);

    const entries = await getAllIndexEntries();
    expect(entries.find((e) => e.token === "掃除トークン")?.refs).toEqual(["c1", "c3"]);
    expect(entries.find((e) => e.token === "消えるトークン")).toBeUndefined();
  });

  it("重複が無ければ何も消さない(冪等: 2回目は0件)", async () => {
    const again = await dedupeStoredSnapshots();
    expect(again.removed).toBe(0);
  });
});
