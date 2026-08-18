// db.test.ts — db.ts(IndexedDBラッパー)の単体テスト(fake-indexeddbで実DB相当を検証)
import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteSnapshot,
  getAlarmEnabled,
  getAllIndexEntries,
  getAllSnapshots,
  getBatteryWebhookConfig,
  getDriveSharedFolderChosen,
  getIndexEntry,
  getNasFolderPath,
  getOpenRouterApiKey,
  getSnapshot,
  getSnapshotsByNote,
  markSnapshotArchived,
  putIndexEntry,
  putSnapshot,
  setAlarmEnabled,
  setBatteryWebhookConfig,
  setDriveSharedFolderChosen,
  setNasFolderPath,
  setOpenRouterApiKey,
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

describe("バッテリー低下警告のGAS Web App接続設定", () => {
  it("未設定ならundefinedを返す", async () => {
    expect(await getBatteryWebhookConfig()).toBeUndefined();
  });

  it("put/get で往復できる", async () => {
    await setBatteryWebhookConfig({
      url: "https://script.google.com/macros/s/xxx/exec",
      token: "secret-token",
    });
    expect(await getBatteryWebhookConfig()).toEqual({
      url: "https://script.google.com/macros/s/xxx/exec",
      token: "secret-token",
    });
  });
});

describe("「共有フォルダを選択」を実行済みか", () => {
  it("未実行ならfalseを返す(自動作成フォルダを使用中)", async () => {
    expect(await getDriveSharedFolderChosen()).toBe(false);
  });

  it("setDriveSharedFolderChosen後はtrueを返す", async () => {
    await setDriveSharedFolderChosen();
    expect(await getDriveSharedFolderChosen()).toBe(true);
  });
});

describe("この端末でアラームを鳴らすか(端末ローカル設定)", () => {
  it("未設定は既定=true(鳴らす。現状挙動を維持)", async () => {
    expect(await getAlarmEnabled()).toBe(true);
  });

  it("false/true を保存して往復できる", async () => {
    await setAlarmEnabled(false);
    expect(await getAlarmEnabled()).toBe(false);
    await setAlarmEnabled(true);
    expect(await getAlarmEnabled()).toBe(true);
  });
});

describe("OpenRouter APIキー", () => {
  it("未設定ならundefinedを返す", async () => {
    expect(await getOpenRouterApiKey()).toBeUndefined();
  });

  it("put/getで往復できる", async () => {
    await setOpenRouterApiKey("sk-or-v1-test");
    expect(await getOpenRouterApiKey()).toBe("sk-or-v1-test");
  });
});

describe("廃止した貼り付け画像ストア(pastedImages)", () => {
  it("DBに pastedImages ストアが存在しない(v4で削除・画像はNASのみに置く)", async () => {
    // 画像をブラウザ内へ貯める経路を残さないことの回帰。ノート添付画像はNASにだけ保存し、
    // タブ内はメモリ上の揮発キャッシュしか持たない(ユーザー指示・2026-07-23)。
    await getAllSnapshots(); // DBを開く(getDbは非公開なので既存の公開APIで起こす)
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("new-tab-board");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      expect([...db.objectStoreNames]).not.toContain("pastedImages");
      expect([...db.objectStoreNames]).toContain("snapshots");
    } finally {
      db.close();
    }
  });
});
