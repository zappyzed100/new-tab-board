// drive.test.ts — drive.ts(Google Drive APIクライアント)の単体テスト(フェイクfetchを注入)
import { describe, expect, it, vi } from "vitest";
import { findFileForNote, uploadNote } from "./drive";

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
