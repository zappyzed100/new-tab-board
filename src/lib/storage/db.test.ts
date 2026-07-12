// db.test.ts — db.ts(IndexedDBラッパー)の単体テスト(fake-indexeddbで実DB相当を検証)
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteSnapshot,
  geminiUsageDateKey,
  getAllIndexEntries,
  getAllSnapshots,
  getGeminiUsageCount,
  getIndexEntry,
  getNasFolderPath,
  getSnapshot,
  getSnapshotsByNote,
  markSnapshotArchived,
  putIndexEntry,
  putSnapshot,
  recordGeminiUsage,
  setNasFolderPath,
} from "./db";

describe("snapshots", () => {
  it("put/get で往復できる", async () => {
    await putSnapshot({ id: "s1", noteId: "n1", timestamp: 1, content: "hello", archived: false });
    const got = await getSnapshot("s1");
    expect(got).toEqual({
      id: "s1",
      noteId: "n1",
      timestamp: 1,
      content: "hello",
      archived: false,
    });
  });

  it("noteId で絞り込める", async () => {
    await putSnapshot({ id: "s2", noteId: "n2", timestamp: 1, content: "a", archived: false });
    await putSnapshot({ id: "s3", noteId: "n2", timestamp: 2, content: "b", archived: false });
    await putSnapshot({ id: "s4", noteId: "n3", timestamp: 1, content: "c", archived: false });
    const forN2 = await getSnapshotsByNote("n2");
    expect(forN2.map((s) => s.id).sort()).toEqual(["s2", "s3"]);
  });

  it("削除すると取得できなくなる", async () => {
    await putSnapshot({ id: "s5", noteId: "n1", timestamp: 1, content: "x", archived: false });
    await deleteSnapshot("s5");
    expect(await getSnapshot("s5")).toBeUndefined();
  });

  it("存在しないIDはundefinedを返す", async () => {
    expect(await getSnapshot("no-such-id")).toBeUndefined();
  });

  it("getAllSnapshots で全ノート横断で取得できる", async () => {
    await putSnapshot({ id: "s6", noteId: "n1", timestamp: 1, content: "a", archived: false });
    await putSnapshot({ id: "s7", noteId: "n2", timestamp: 1, content: "b", archived: false });
    const all = await getAllSnapshots();
    expect(all.map((s) => s.id)).toEqual(expect.arrayContaining(["s6", "s7"]));
  });

  it("markSnapshotArchivedで本体を消しarchived/archivePathを立てる", async () => {
    await putSnapshot({ id: "s8", noteId: "n1", timestamp: 1, content: "secret", archived: false });
    await markSnapshotArchived("s8", "n1-1-s8.snapshot");
    const got = await getSnapshot("s8");
    expect(got).toEqual({
      id: "s8",
      noteId: "n1",
      timestamp: 1,
      content: undefined,
      archived: true,
      archivePath: "n1-1-s8.snapshot",
    });
  });

  it("存在しないIDへのmarkSnapshotArchivedは何もしない", async () => {
    await expect(markSnapshotArchived("no-such-id", "x")).resolves.toBeUndefined();
  });
});

describe("searchIndex", () => {
  beforeEach(async () => {
    await putIndexEntry({ token: "hello", refs: ["s1"] });
  });

  it("put/get で往復できる", async () => {
    expect(await getIndexEntry("hello")).toEqual({ token: "hello", refs: ["s1"] });
  });

  it("getAllIndexEntries で全件取得できる", async () => {
    await putIndexEntry({ token: "world", refs: ["s2"] });
    const all = await getAllIndexEntries();
    expect(all.map((e) => e.token).sort()).toEqual(["hello", "world"]);
  });
});

describe("NASフォルダのパス", () => {
  it("未設定ならundefinedを返す", async () => {
    expect(await getNasFolderPath()).toBeUndefined();
  });

  it("put/get で往復できる", async () => {
    await setNasFolderPath("Z:\\NAS\\backup");
    expect(await getNasFolderPath()).toBe("Z:\\NAS\\backup");
  });
});

describe("Gemini使用量カウント", () => {
  it("recordGeminiUsageは今日の回数を1ずつ増やして返す", async () => {
    const day = "2026-07-13";
    expect(await getGeminiUsageCount(day)).toBe(0);
    expect(await recordGeminiUsage(day)).toBe(1);
    expect(await recordGeminiUsage(day)).toBe(2);
    expect(await getGeminiUsageCount(day)).toBe(2);
  });

  it("日付が変わると0から数え直す(前日分は今日の集計に混ざらない)", async () => {
    const d1 = "2026-08-01";
    const d2 = "2026-08-02";
    await recordGeminiUsage(d1);
    await recordGeminiUsage(d1); // d1 = 2回
    expect(await getGeminiUsageCount(d2)).toBe(0); // 別日は0
    expect(await recordGeminiUsage(d2)).toBe(1); // d2で1から数え直し
    expect(await getGeminiUsageCount(d1)).toBe(0); // 記録がd2へ置き換わり、d1問い合わせは0
  });

  it("geminiUsageDateKeyはローカル日付のYYYY-MM-DDを返す", () => {
    // 月はローカル成分で構築し、同じローカル成分で読むためタイムゾーンに依らず一致する。
    expect(geminiUsageDateKey(new Date(2026, 6, 13, 10, 30).getTime())).toBe("2026-07-13");
    expect(geminiUsageDateKey(new Date(2026, 0, 5, 0, 0).getTime())).toBe("2026-01-05");
  });
});
