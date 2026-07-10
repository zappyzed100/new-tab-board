// useSnapshotScheduler.test.ts — forceSnapshot(即時保存。SPEC.md §6)の単体テスト
// useSnapshotScheduler自体(Reactフック本体)は編集区切り検出のタイマー/DOMイベント配線のみで
// 中身のロジックはhistory.test.tsで既にテスト済みのため、ここでは配線を伴わない
// forceSnapshotのみを対象にする(db.ts/search.tsは実体をfake-indexeddb経由で使う)。
import { describe, expect, it } from "vitest";
import { forceSnapshot } from "./useSnapshotScheduler";
import { getSnapshotsByNote } from "./db";
import { searchSnapshotIds } from "./search";
import { gzipDecompress } from "./gzip";

describe("forceSnapshot", () => {
  it("db.tsへスナップショットを1件保存する(archived:falseで即座に本文を持つ)", async () => {
    await forceSnapshot("note-1", "こんにちは世界");
    const snapshots = await getSnapshotsByNote("note-1");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].archived).toBe(false);
    expect(await gzipDecompress(snapshots[0].content!)).toBe("こんにちは世界");
  });

  it("全文検索インデックスにも反映される", async () => {
    // tokenize.tsは分かち書き言語向けの単語境界分割のため、日本語部分は連続する
    // 文字列全体が1トークンになる(既知の制約)。クエリと完全一致させるため、
    // 半角スペースで区切った単独トークンを検索語に使う。
    await forceSnapshot("note-2", "メモ searchable-keyword 本文");
    const ids = await searchSnapshotIds("searchable-keyword");
    const snapshots = await getSnapshotsByNote("note-2");
    expect(ids).toContain(snapshots[0].id);
  });

  it("呼ぶたびに新しいスナップショットを追加する(上書きしない)", async () => {
    await forceSnapshot("note-3", "1回目");
    await forceSnapshot("note-3", "2回目");
    const snapshots = await getSnapshotsByNote("note-3");
    expect(snapshots).toHaveLength(2);
  });
});
