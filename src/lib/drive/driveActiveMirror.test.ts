// driveActiveMirror.test.ts — active/ の突き合わせ削除と日付フォルダ格納の単体テスト
import { describe, expect, it, vi } from "vitest";
import {
  copyNotesToDriveDateFolder,
  dateFolderParts,
  pushTodosToDriveActive,
  reconcileDriveActive,
} from "./driveActiveMirror";
import { noteToMarkdown } from "../externalIO/nasArchive";
import type { Note, Todo } from "../../types";

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

const note = (id: string, content: string): Note =>
  ({ id, title: id, content, pinned: false, order: 0 }) as Note;

describe("dateFolderParts", () => {
  it("YYYY/M/D(4桁年・非ゼロ埋め。NASと同一書式)を返す", () => {
    expect(dateFolderParts(new Date(2026, 6, 13).getTime())).toEqual(["2026", "7", "13"]);
    expect(dateFolderParts(new Date(2026, 0, 5).getTime())).toEqual(["2026", "1", "5"]);
  });
});

describe("reconcileDriveActive", () => {
  it("active/にあって現在の非空ノートに無いファイルを削除する(日付フォルダには触れない)", async () => {
    const resolveFolderPath = vi.fn().mockResolvedValue("active-folder");
    const listNoteFilesInFolder = vi.fn().mockResolvedValue([
      { id: "fa-keep", noteId: "n1" },
      { id: "fa-gone", noteId: "n2" }, // n2はもう存在しない → 削除
    ]);
    const deleteDriveFile = vi.fn().mockResolvedValue(undefined);
    const uploadNote = vi.fn();

    const notes = [note("n1", "本文"), note("n3", "  ")]; // n1=非空, n3=空
    const res = await reconcileDriveActive(notes, "tok", {
      resolveFolderPath,
      listNoteFilesInFolder,
      deleteDriveFile,
      uploadNote,
    });

    // n2(現在存在しない)のactiveファイルを削除。n1(残る)は削除しない。
    expect(deleteDriveFile).toHaveBeenCalledTimes(1);
    expect(deleteDriveFile).toHaveBeenCalledWith("fa-gone", "tok");
    // 日付フォルダへの格納は日次ジョブ(copyNotesToDriveDateFolder)の責務。ここでは上げない。
    expect(uploadNote).not.toHaveBeenCalled();
    expect(res).toEqual({ deleted: 1 });
  });

  it("空になったノートのactiveファイルも削除する(非空セットに無いため)", async () => {
    const resolveFolderPath = vi.fn().mockResolvedValue("active");
    const listNoteFilesInFolder = vi.fn().mockResolvedValue([{ id: "fa", noteId: "n1" }]);
    const deleteDriveFile = vi.fn().mockResolvedValue(undefined);

    const res = await reconcileDriveActive([note("n1", "")], "t", {
      resolveFolderPath,
      listNoteFilesInFolder,
      deleteDriveFile,
    });
    expect(deleteDriveFile).toHaveBeenCalledWith("fa", "t");
    expect(res).toEqual({ deleted: 1 });
  });
});

describe("copyNotesToDriveDateFolder", () => {
  it("指定日(前日)の日付フォルダへ非空ノートを<id>.md(Markdown+front matter)で格納する。空は上げない", async () => {
    const resolveFolderPath = vi.fn().mockResolvedValue("date-folder");
    const listNoteFilesInFolder = vi.fn().mockResolvedValue([]); // 日付フォルダは空
    const uploadNote = vi.fn().mockResolvedValue("uploaded");

    const notes = [note("n1", "本文"), note("n3", "  ")]; // n1=非空, n3=空
    const dayMs = new Date(2026, 6, 13).getTime();
    const res = await copyNotesToDriveDateFolder(notes, dayMs, "tok", {
      resolveFolderPath,
      listNoteFilesInFolder,
      uploadNote,
    });

    expect(uploadNote).toHaveBeenCalledTimes(1);
    expect(uploadNote).toHaveBeenCalledWith(
      { id: "n1", title: "n1", content: noteToMarkdown(notes[0]) },
      "tok",
      null,
      undefined,
      { folderId: "date-folder", kind: "date:2026/7/13", filename: "n1.md" },
    );
    expect(res).toEqual({ dated: 1 });
  });

  it("同日に既にあるファイルは上書き(PATCH)する(既存fileIdを渡す)", async () => {
    const resolveFolderPath = vi.fn().mockResolvedValue("date-folder");
    const listNoteFilesInFolder = vi
      .fn()
      .mockResolvedValue([{ id: "existing-file", noteId: "n1" }]);
    const uploadNote = vi.fn().mockResolvedValue("existing-file");

    const notes = [note("n1", "本文")];
    const res = await copyNotesToDriveDateFolder(notes, new Date(2026, 0, 5).getTime(), "tok", {
      resolveFolderPath,
      listNoteFilesInFolder,
      uploadNote,
    });

    expect(uploadNote).toHaveBeenCalledWith(
      { id: "n1", title: "n1", content: noteToMarkdown(notes[0]) },
      "tok",
      "existing-file", // 既存fileIdを渡す=PATCH
      undefined,
      { folderId: "date-folder", kind: "date:2026/1/5", filename: "n1.md" },
    );
    expect(res).toEqual({ dated: 1 });
  });
});

describe("pushTodosToDriveActive", () => {
  const todos: Todo[] = [{ id: "t1", text: "買い物", done: false, order: 0 }];

  it("既存が無ければPOST(新規作成)し、noteIdをappPropertiesに含めない(reconcileDriveActiveの削除対象から外すため)", async () => {
    const resolveFolderPath = vi.fn().mockResolvedValue("active-folder");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [] })) // 検索: 無し
      .mockResolvedValueOnce(fakeResponse({ id: "new-file" })); // 作成
    const ok = await pushTodosToDriveActive(todos, "tok", { resolveFolderPath, fetchImpl });
    expect(ok).toBe(true);
    const [, init] = fetchImpl.mock.calls[1];
    expect(init.method).toBe("POST");
    expect(init.body).toContain("todos.txt");
    expect(init.body).not.toContain("noteId");
    expect(init.body).toContain("- [ ] 買い物");
  });

  it("既存が見つかればPATCH(更新)する", async () => {
    const resolveFolderPath = vi.fn().mockResolvedValue("active-folder");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "existing-todos" }] }))
      .mockResolvedValueOnce(fakeResponse({ id: "existing-todos" }));
    const ok = await pushTodosToDriveActive(todos, "tok", { resolveFolderPath, fetchImpl });
    expect(ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[1];
    expect(init.method).toBe("PATCH");
    expect(url).toContain("existing-todos");
  });

  it("アップロード失敗はfalseを返す", async () => {
    const resolveFolderPath = vi.fn().mockResolvedValue("active-folder");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [] }))
      .mockResolvedValueOnce(fakeResponse({}, false, 500));
    const ok = await pushTodosToDriveActive(todos, "tok", { resolveFolderPath, fetchImpl });
    expect(ok).toBe(false);
  });

  it(
    "mimeTypeはtext/plainにする(新規作成・更新どちらも)——2026-07-16: iPhoneのDriveアプリで" +
      "text/markdownが「サポートされていないファイル形式です」となり開けなかった不具合の修正",
    async () => {
      const resolveFolderPath = vi.fn().mockResolvedValue("active-folder");
      const createFetch = vi
        .fn()
        .mockResolvedValueOnce(fakeResponse({ files: [] }))
        .mockResolvedValueOnce(fakeResponse({ id: "new-file" }));
      await pushTodosToDriveActive(todos, "tok", { resolveFolderPath, fetchImpl: createFetch });
      expect(createFetch.mock.calls[1][1].body).toContain('"mimeType":"text/plain"');
      expect(createFetch.mock.calls[1][1].body).toContain("Content-Type: text/plain");

      const patchFetch = vi
        .fn()
        .mockResolvedValueOnce(fakeResponse({ files: [{ id: "existing-todos" }] }))
        .mockResolvedValueOnce(fakeResponse({ id: "existing-todos" }));
      await pushTodosToDriveActive(todos, "tok", { resolveFolderPath, fetchImpl: patchFetch });
      expect(patchFetch.mock.calls[1][1].body).toContain('"mimeType":"text/plain"');
    },
  );
});
