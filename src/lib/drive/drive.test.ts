// drive.test.ts — drive.ts(Google Drive APIクライアント)の単体テスト(フェイクfetchを注入)
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteDriveFile,
  findFileForNote,
  getOrCreateFolder,
  listNoteFilesInFolder,
  resetDriveFolderCache,
  resolveFolderPath,
  uploadNote,
} from "./drive";
import { getDriveFolderIds, saveDriveFolderId } from "../storage/db";

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
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

  it("上書き(PATCH)のmetadataにtrashed:falseを含める(ゴミ箱のファイルを指すdriveFileIdへ上書きし続けても復活しない不具合の回帰。jsonBackupと同じ罠)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "file-1" }));
    await uploadNote(note, "token-abc", "file-1", fetchImpl);
    expect(fetchImpl.mock.calls[0][1].body).toContain('"trashed":false');
  });

  it("新規作成(POST)のmetadataにtrashedを含めない(files.createはtrashedが書き込み不可フィールドでHTTP 403 fieldNotWritableになった実機不具合の回帰)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "new-file" }));
    await uploadNote(note, "token-abc", null, fetchImpl);
    expect(fetchImpl.mock.calls[0][1].body).not.toContain("trashed");
  });

  it("上書き(PATCH)でopts.folderIdがあればaddParents/removeParents=rootを送り、正しいフォルダへ入れ直す(実機でactiveファイルがマイドライブ直下に迷い込んだまま直らなかった不具合の回帰)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "file-1" }));
    await uploadNote(note, "token-abc", "file-1", fetchImpl, { folderId: "folder-active" });
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).toContain("addParents=folder-active");
    expect(url).toContain("removeParents=root");
  });

  it("上書き(PATCH)でもopts.folderIdが無ければaddParents/removeParentsを送らない", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "file-1" }));
    await uploadNote(note, "token-abc", "file-1", fetchImpl);
    const url = fetchImpl.mock.calls[0][0] as string;
    expect(url).not.toContain("addParents");
  });

  it("更新(PATCH)でもファイル名を送り直す(タイトルベースのactiveファイル名がリネームに追従するため)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "file-1" }));
    await uploadNote(note, "token-abc", "file-1", fetchImpl, { filename: "新しいタイトル.md" });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.body).toContain("新しいタイトル.md");
  });

  it("mimeTypeは既定でtext/markdownにする(新規作成)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "new-file" }));
    await uploadNote(note, "token-abc", null, fetchImpl);
    expect(fetchImpl.mock.calls[0][1].body).toContain('"mimeType":"text/markdown"');
  });

  it(
    "opts.mimeTypeを渡すと新規作成・更新どちらでもそのmimeTypeを送る" +
      "(2026-07-16: active/(拡張子.txt)をtext/plainにする回帰。iPhoneのDriveアプリで" +
      "text/markdownが「サポートされていないファイル形式です」となり開けなかった不具合の修正——" +
      "PATCHでも送るのは、以前text/markdownで作られていた既存ファイルを是正するため)",
    async () => {
      const createFetch = vi.fn().mockResolvedValue(fakeResponse({ id: "new-file" }));
      await uploadNote(note, "token-abc", null, createFetch, { mimeType: "text/plain" });
      expect(createFetch.mock.calls[0][1].body).toContain('"mimeType":"text/plain"');
      expect(createFetch.mock.calls[0][1].body).toContain("Content-Type: text/plain");

      const patchFetch = vi.fn().mockResolvedValue(fakeResponse({ id: "file-1" }));
      await uploadNote(note, "token-abc", "file-1", patchFetch, { mimeType: "text/plain" });
      expect(patchFetch.mock.calls[0][1].body).toContain('"mimeType":"text/plain"');
    },
  );

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
  beforeEach(async () => await resetDriveFolderCache());

  it("既存フォルダが見つかればそのIDを返し、作成はしない(検索条件は名前+親フォルダ)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ files: [{ id: "folder-x" }] }));
    const id = await getOrCreateFolder("active", "parent-1", "tok", fetchImpl);
    expect(id).toBe("folder-x");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 検索のみ(作成POSTなし)
    const [url] = fetchImpl.mock.calls[0];
    const q = decodeURIComponent(url as string);
    expect(q).toContain("name='active'");
    expect(q).toContain("'parent-1' in parents"); // 名前だけでなく親フォルダも検索条件に含む
    expect(q).toContain("trashed=false");
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

  it("永続キャッシュに保存済みのIDがあれば、名前検索はせず実在確認だけして直接使う(ユーザー設計の優先順位1: セッションを跨いだ再訪問を模す)", async () => {
    // resetDriveFolderCacheで空にしたところへ、前回セッションで解決済みだった
    // 想定のIDを直接書き込む(セッション内のfolderIdCacheには一切触れない=タブを閉じて
    // 開き直した状況を再現する)。名前+親での検索(getOrCreateFolder)は行わないが、
    // 実在確認(GET /files/{id})は行う(手動削除の検知——下の「stale」テスト参照)。
    await saveDriveFolderId("app", "app-id");
    await saveDriveFolderId("app/New Tab Board", "board-id");
    await saveDriveFolderId("app/New Tab Board/active", "active-id");
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ id: "x", trashed: false }));
    const parts = ["app", "New Tab Board", "active"];
    expect(await resolveFolderPath(parts, "tok", fetchImpl)).toBe("active-id");
    // 3段それぞれ実在確認の1回だけ(名前+親の検索クエリは1回も飛ばない)。
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const call of fetchImpl.mock.calls) {
      expect(call[0]).not.toContain("q=");
    }
  });

  it("永続キャッシュのIDがDrive上で削除/ゴミ箱済みなら、キャッシュを捨てて名前検索→作成へ再解決する(ユーザーがDriveの中身を手で削除した後もキャッシュが死んだIDを返し続け、addParents等が404し続けた不具合の回帰)", async () => {
    await saveDriveFolderId("solo", "dead-id");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({}, false, 404)) // 実在確認: 404(消えている)
      .mockResolvedValueOnce(fakeResponse({ files: [] })) // 名前+親での検索: 無し
      .mockResolvedValueOnce(fakeResponse({ id: "revived-id" })); // 新規作成
    const id = await resolveFolderPath(["solo"], "tok", fetchImpl);
    expect(id).toBe("revived-id");
    expect(await getDriveFolderIds()).toEqual({ solo: "revived-id" });
  });

  it("新規に解決したフォルダIDは永続キャッシュへ保存する(次回セッションは検索しない)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [] })) // 検索: 無し
      .mockResolvedValueOnce(fakeResponse({ id: "solo-id" })); // 作成
    const id = await resolveFolderPath(["solo"], "tok", fetchImpl);
    expect(id).toBe("solo-id");
    expect(await getDriveFolderIds()).toEqual({ solo: "solo-id" });
  });

  it("見つかった(作成せず)フォルダIDも永続キャッシュへ保存する", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ files: [{ id: "found-id" }] }));
    await resolveFolderPath(["existing"], "tok", fetchImpl);
    expect(await getDriveFolderIds()).toEqual({ existing: "found-id" });
  });

  it("同じパスへの同時呼び出しはフォルダを1回だけ作成する(複数ペインが同時にCmd/Ctrl+S同期する状況の回帰)", async () => {
    // 検索は常に「まだ無い」を返す——修正前は各同時呼び出しがそれぞれ独立に
    // 検索→作成してしまい、同名フォルダ(app/New Tab Board等)が複製されるバグがあった
    // (ユーザー報告: Drive上にappフォルダ・New Tab Boardフォルダが複数できる)。
    let createCount = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        createCount += 1;
        return fakeResponse({ id: `created-${createCount}` });
      }
      return fakeResponse({ files: [] });
    });
    const parts = ["app", "New Tab Board", "active"];
    // 5つのノートペインがほぼ同時にresolveFolderPathを呼ぶ状況を再現(await無しで並行発火)。
    const results = await Promise.all(
      Array.from({ length: 5 }, () => resolveFolderPath(parts, "tok", fetchImpl)),
    );
    // 全員が同じフォルダIDへ解決される(バグがあれば各々別の新規作成IDになっていた)。
    expect(new Set(results).size).toBe(1);
    // 3段(app / New Tab Board / active)それぞれにつき作成は1回だけ。
    expect(createCount).toBe(3);
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

  it("クエリに`!=`を含めない(Drive APIのappProperties has句は完全一致しか受け付けず、実機でHTTP 400になっていた)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ files: [] }));
    await listNoteFilesInFolder("folder-1", "tok", fetchImpl);
    const requestedUrl = fetchImpl.mock.calls[0][0] as string;
    const q = decodeURIComponent(new URL(requestedUrl).searchParams.get("q") ?? "");
    expect(q).not.toContain("!=");
  });
});
