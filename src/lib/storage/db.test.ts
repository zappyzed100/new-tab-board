// db.test.ts — db.ts(IndexedDBラッパー)の単体テスト(fake-indexeddbで実DB相当を検証)
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteSnapshot,
  getAllIndexEntries,
  getAllSnapshots,
  getIndexEntry,
  getNasDirectoryHandle,
  getSnapshot,
  getSnapshotsByNote,
  markSnapshotArchived,
  putIndexEntry,
  putSnapshot,
  setNasDirectoryHandle,
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

describe("NASディレクトリハンドル", () => {
  it("未設定ならundefinedを返す", async () => {
    expect(await getNasDirectoryHandle()).toBeUndefined();
  });

  it("put/get で往復できる", async () => {
    const fakeHandle = { kind: "directory", name: "archive" };
    await setNasDirectoryHandle(fakeHandle as unknown as FileSystemDirectoryHandle);
    expect(await getNasDirectoryHandle()).toEqual(fakeHandle);
  });
});
