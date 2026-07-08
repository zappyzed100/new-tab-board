// db.test.ts — db.ts(IndexedDBラッパー)の単体テスト(fake-indexeddbで実DB相当を検証)
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteSnapshot,
  getAllIndexEntries,
  getIndexEntry,
  getSnapshot,
  getSnapshotsByNote,
  putIndexEntry,
  putSnapshot,
} from "./db";

describe("snapshots", () => {
  it("put/get で往復できる", async () => {
    await putSnapshot({ id: "s1", noteId: "n1", timestamp: 1, content: "hello" });
    const got = await getSnapshot("s1");
    expect(got).toEqual({ id: "s1", noteId: "n1", timestamp: 1, content: "hello" });
  });

  it("noteId で絞り込める", async () => {
    await putSnapshot({ id: "s2", noteId: "n2", timestamp: 1, content: "a" });
    await putSnapshot({ id: "s3", noteId: "n2", timestamp: 2, content: "b" });
    await putSnapshot({ id: "s4", noteId: "n3", timestamp: 1, content: "c" });
    const forN2 = await getSnapshotsByNote("n2");
    expect(forN2.map((s) => s.id).sort()).toEqual(["s2", "s3"]);
  });

  it("削除すると取得できなくなる", async () => {
    await putSnapshot({ id: "s5", noteId: "n1", timestamp: 1, content: "x" });
    await deleteSnapshot("s5");
    expect(await getSnapshot("s5")).toBeUndefined();
  });

  it("存在しないIDはundefinedを返す", async () => {
    expect(await getSnapshot("no-such-id")).toBeUndefined();
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
