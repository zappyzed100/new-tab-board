// jsonBackup.test.ts — jsonBackup.ts(全データJSONバックアップのDrive APIクライアント)の
// 単体テスト(フェイクfetchを注入)
import { describe, expect, it, vi } from "vitest";
import { downloadBackup, findBackupFile, uploadBackup } from "./jsonBackup";

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("findBackupFile", () => {
  it("見つかったファイルIDを返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ files: [{ id: "backup-1" }] }));
    const id = await findBackupFile("token-abc", fetchImpl);
    expect(id).toBe("backup-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("newTabBoardBackup");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
  });

  it("見つからなければnullを返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ files: [] }));
    expect(await findBackupFile("token-abc", fetchImpl)).toBeNull();
  });

  it("HTTPエラーは例外を投げる", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 401));
    await expect(findBackupFile("token-abc", fetchImpl)).rejects.toThrow("HTTP 401");
  });
});

describe("uploadBackup", () => {
  const json = '{"version":1,"bookmarks":[]}';

  it("既存ファイルIDが無ければPOST(新規作成)する", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "new-file" }));
    const id = await uploadBackup(json, "token-abc", null, null, fetchImpl);
    expect(id).toBe("new-file");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(url).not.toContain("new-file");
    expect(init.body).toContain("new-tab-board-backup.json");
  });

  it("folderIdを渡すと新規作成時にそのフォルダへ入れる(app/New Tab Board/配下へ統一)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "new-file" }));
    await uploadBackup(json, "token-abc", null, "folder-app", fetchImpl);
    expect(fetchImpl.mock.calls[0][1].body).toContain('"parents":["folder-app"]');
  });

  it("既存ファイルIDがあればPATCH(更新)する", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "file-1" }));
    const id = await uploadBackup(json, "token-abc", "file-1", null, fetchImpl);
    expect(id).toBe("file-1");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(url).toContain("file-1");
  });

  it("既存ファイルの上書きでfolderIdがあればaddParents/removeParents=rootを送り、正しいフォルダへ移す(マイドライブ直下に置かれていた旧バックアップの移行用)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "file-1" }));
    await uploadBackup(json, "token-abc", "file-1", "folder-app", fetchImpl);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain("addParents=folder-app");
    expect(url).toContain("removeParents=root");
  });

  it("HTTPエラーは例外を投げる", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 500));
    await expect(uploadBackup(json, "token-abc", null, null, fetchImpl)).rejects.toThrow(
      "HTTP 500",
    );
  });

  it("上書き(PATCH)のmetadataにtrashed:falseを含める(ゴミ箱のファイルへ上書きし続けても復活せず、どこにも見えないままだった不具合の回帰)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "file-1" }));
    await uploadBackup(json, "token-abc", "file-1", null, fetchImpl);
    expect(fetchImpl.mock.calls[0][1].body).toContain('"trashed":false');
  });

  it("既存ファイルIDが消えている(404)なら、新規作成にフォールバックして新IDを返す", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({}, false, 404)) // 古いIDへのPATCHが404
      .mockResolvedValueOnce(fakeResponse({ id: "recreated" })); // 新規作成POSTは成功
    const id = await uploadBackup(json, "token-abc", "gone-file", null, fetchImpl);
    expect(id).toBe("recreated");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].method).toBe("PATCH");
    expect(fetchImpl.mock.calls[1][1].method).toBe("POST");
  });
});

describe("downloadBackup", () => {
  it("ファイル本文(JSON文字列)を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse('{"version":1}'));
    const json = await downloadBackup("file-1", "token-abc", fetchImpl);
    expect(json).toBe('{"version":1}');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("file-1");
    expect(url).toContain("alt=media");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
  });

  it("HTTPエラーは例外を投げる", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse("", false, 404));
    await expect(downloadBackup("file-1", "token-abc", fetchImpl)).rejects.toThrow("HTTP 404");
  });
});
