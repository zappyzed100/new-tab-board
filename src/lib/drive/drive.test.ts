// drive.test.ts — drive.ts(Google Drive APIクライアント)の単体テスト(フェイクfetchを注入)
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteDriveFile,
  findFileForNote,
  getOrCreateFolder,
  listNoteFilesInFolder,
  resetDriveFolderCacheForTests,
  resolveFolderPath,
  uploadNote,
} from "./drive";

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("findFileForNote", () => {
  it("見つかったファイルIDを返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ files: [{ id: "file-1" }] }));
    const id = await findFileForNote("note-1", "token-abc", fetchImpl);
    expect(id).toBe("file-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("noteId");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
  });

  it("見つからなければnullを返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ files: [] }));
    expect(await findFileForNote("note-1", "token-abc", fetchImpl)).toBeNull();
  });

  it("HTTPエラーは例外を投げる", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 401));
    await expect(findFileForNote("note-1", "token-abc", fetchImpl)).rejects.toThrow("HTTP 401");
  });
});

describe("uploadNote", () => {
  const note = { id: "note-1", title: "会議メモ", content: "本文" };

  it("既存ファイルIDが無ければPOST(新規作成)する", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "new-file" }));
    const id = await uploadNote(note, "token-abc", null, fetchImpl);
    expect(id).toBe("new-file");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(url).not.toContain("new-file");
    expect(init.body).toContain("会議メモ.md");
  });

  it("既存ファイルIDがあればPATCH(更新)する", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "file-1" }));
    const id = await uploadNote(note, "token-abc", "file-1", fetchImpl);
    expect(id).toBe("file-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(url).toContain("file-1");
  });

  it("HTTPエラーは例外を投げる", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 500));
    await expect(uploadNote(note, "token-abc", null, fetchImpl)).rejects.toThrow("HTTP 500");
  });

  it("既存ファイルIDが消えている(404)なら、新規作成にフォールバックして新IDを返す", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({}, false, 404)) // 古いIDへのPATCHが404
      .mockResolvedValueOnce(fakeResponse({ id: "recreated" })); // 新規作成POSTは成功
    const id = await uploadNote(note, "token-abc", "gone-file", fetchImpl);
    expect(id).toBe("recreated");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].method).toBe("PATCH");
    expect(fetchImpl.mock.calls[1][1].method).toBe("POST"); // フォールバックは新規作成
  });
});

describe("getOrCreateFolder / resolveFolderPath", () => {
  beforeEach(() => resetDriveFolderCacheForTests());

  it("既存フォルダが見つかればそのIDを返し、作成はしない", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ files: [{ id: "folder-x" }] }));
    const id = await getOrCreateFolder("active", "parent-1", "tok", fetchImpl);
    expect(id).toBe("folder-x");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 検索のみ(作成POSTなし)
  });

  it("無ければ作成する(検索→作成の2回)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [] })) // 検索: 無し
      .mockResolvedValueOnce(fakeResponse({ id: "new-folder" })); // 作成
    const id = await getOrCreateFolder("active", null, "tok", fetchImpl);
    expect(id).toBe("new-folder");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].method).toBe("POST");
  });

  it("resolveFolderPathは各段をget-or-createして末端IDを返す(2度目はキャッシュで叩かない)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "app-id" }] })) // app
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "board-id" }] })) // New Tab Board
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "active-id" }] })); // active
    const parts = ["app", "New Tab Board", "active"];
    expect(await resolveFolderPath(parts, "tok", fetchImpl)).toBe("active-id");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // 2度目はキャッシュヒットで通信ゼロ。
    expect(await resolveFolderPath(parts, "tok", fetchImpl)).toBe("active-id");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("deleteDriveFile", () => {
  it("DELETEを投げる。404は成功扱い(既に無い)", async () => {
    const ok = vi.fn().mockResolvedValue(fakeResponse({}, true, 204));
    await expect(deleteDriveFile("f1", "tok", ok)).resolves.toBeUndefined();
    expect(ok.mock.calls[0][1].method).toBe("DELETE");
    const gone = vi.fn().mockResolvedValue(fakeResponse({}, false, 404));
    await expect(deleteDriveFile("f1", "tok", gone)).resolves.toBeUndefined();
  });

  it("404以外のエラーは例外", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 500));
    await expect(deleteDriveFile("f1", "tok", fetchImpl)).rejects.toThrow("HTTP 500");
  });
});

describe("listNoteFilesInFolder", () => {
  it("noteIdを持つファイルだけ{id,noteId}で返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse({
        files: [
          { id: "a", appProperties: { noteId: "n1" } },
          { id: "b", appProperties: {} }, // noteId無し→除外
          { id: "c", appProperties: { noteId: "n2" } },
        ],
      }),
    );
    expect(await listNoteFilesInFolder("folder-1", "tok", fetchImpl)).toEqual([
      { id: "a", noteId: "n1" },
      { id: "c", noteId: "n2" },
    ]);
  });
});
