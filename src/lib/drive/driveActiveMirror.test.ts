// driveActiveMirror.test.ts — active/ の突き合わせ削除と日付フォルダ格納の単体テスト
import { describe, expect, it, vi } from "vitest";
import { dateFolderParts, reconcileDriveActive } from "./driveActiveMirror";
import { noteToMarkdown } from "../externalIO/nasArchive";
import type { Note } from "../../types";

const note = (id: string, content: string): Note =>
  ({ id, title: id, content, pinned: false, order: 0 }) as Note;

describe("dateFolderParts", () => {
  it("YYYY/M/D(4桁年・非ゼロ埋め。NASと同一書式)を返す", () => {
    expect(dateFolderParts(new Date(2026, 6, 13).getTime())).toEqual(["2026", "7", "13"]);
    expect(dateFolderParts(new Date(2026, 0, 5).getTime())).toEqual(["2026", "1", "5"]);
  });
});

describe("reconcileDriveActive", () => {
  it("active/にあって現在の非空ノートに無いファイルを削除し、日付フォルダへ非空ノートを格納する", async () => {
    const resolveFolderPath = vi
      .fn()
      .mockResolvedValueOnce("active-folder") // 1回目: active
      .mockResolvedValueOnce("date-folder"); // 2回目: 日付
    const listNoteFilesInFolder = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "fa-keep", noteId: "n1" },
        { id: "fa-gone", noteId: "n2" }, // n2はもう存在しない → 削除
      ])
      .mockResolvedValueOnce([]); // 日付フォルダは空
    const deleteDriveFile = vi.fn().mockResolvedValue(undefined);
    const uploadNote = vi.fn().mockResolvedValue("uploaded");

    const notes = [note("n1", "本文"), note("n3", "  ")]; // n1=非空, n3=空
    const res = await reconcileDriveActive(notes, new Date(2026, 6, 13).getTime(), "tok", {
      resolveFolderPath,
      listNoteFilesInFolder,
      deleteDriveFile,
      uploadNote,
    });

    // n2(現在存在しない)のactiveファイルを削除。n1(残る)は削除しない。
    expect(deleteDriveFile).toHaveBeenCalledTimes(1);
    expect(deleteDriveFile).toHaveBeenCalledWith("fa-gone", "tok");
    // 日付フォルダには非空(n1)だけ、<id>.md へ Markdown+front matter で格納。空(n3)は上げない。
    expect(uploadNote).toHaveBeenCalledTimes(1);
    expect(uploadNote).toHaveBeenCalledWith(
      { id: "n1", title: "n1", content: noteToMarkdown(notes[0]) },
      "tok",
      null,
      undefined,
      { folderId: "date-folder", kind: "date:2026/7/13", filename: "n1.md" },
    );
    expect(res).toEqual({ deleted: 1, dated: 1 });
  });

  it("空になったノートのactiveファイルも削除する(非空セットに無いため)。空は日付にも上げない", async () => {
    const resolveFolderPath = vi.fn().mockResolvedValueOnce("active").mockResolvedValueOnce("date");
    const listNoteFilesInFolder = vi
      .fn()
      .mockResolvedValueOnce([{ id: "fa", noteId: "n1" }]) // active: n1のファイルが残っている
      .mockResolvedValueOnce([]);
    const deleteDriveFile = vi.fn().mockResolvedValue(undefined);
    const uploadNote = vi.fn();

    const res = await reconcileDriveActive([note("n1", "")], 0, "t", {
      resolveFolderPath,
      listNoteFilesInFolder,
      deleteDriveFile,
      uploadNote,
    });
    expect(deleteDriveFile).toHaveBeenCalledWith("fa", "t");
    expect(uploadNote).not.toHaveBeenCalled();
    expect(res).toEqual({ deleted: 1, dated: 0 });
  });
});
