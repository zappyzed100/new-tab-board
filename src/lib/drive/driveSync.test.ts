// driveSync.test.ts — driveSync.ts(Drive同期オーケストレーション)の単体テスト
import { describe, expect, it, vi } from "vitest";
import { syncNoteToDrive } from "./driveSync";
import { noteToMarkdown } from "../externalIO/nasArchive";
import type { Note } from "../../types";

const note: Note = { id: "n1", title: "会議メモ", content: "本文", pinned: false, order: 0 };
// active/<id>.md へは Markdown+front matter で書く(uploadNoteのcontentへmdを渡す)。
const mdNote = { id: note.id, title: note.title, content: noteToMarkdown(note) };
const ACTIVE_OPTS = { folderId: "active-folder", kind: "active", filename: "n1.md" };

describe("syncNoteToDrive", () => {
  it("未認証(token無し)ならunauthenticatedを返し、アップロードは呼ばない", async () => {
    const uploadNote = vi.fn();
    const result = await syncNoteToDrive(note, 1000, false, {
      getAuthToken: vi.fn().mockResolvedValue(null),
      uploadNote,
    });
    expect(result).toEqual({ status: "unauthenticated" });
    expect(uploadNote).not.toHaveBeenCalled();
  });

  it("空ノートはアップロードせずskipped-emptyを返す(ユーザー指示: 空ファイルは上げない)", async () => {
    const uploadNote = vi.fn();
    const getAuthToken = vi.fn();
    const result = await syncNoteToDrive({ ...note, content: "  \n " }, 1000, false, {
      getAuthToken,
      uploadNote,
    });
    expect(result).toEqual({ status: "skipped-empty" });
    expect(getAuthToken).not.toHaveBeenCalled();
    expect(uploadNote).not.toHaveBeenCalled();
  });

  it("driveFileId未設定なら active フォルダを解決し、検索してから新規アップロードする", async () => {
    const resolveFolderPath = vi.fn().mockResolvedValue("active-folder");
    const findFileForNote = vi.fn().mockResolvedValue(null);
    const uploadNote = vi.fn().mockResolvedValue("new-file-id");
    const result = await syncNoteToDrive(note, 1000, false, {
      getAuthToken: vi.fn().mockResolvedValue("token-abc"),
      resolveFolderPath,
      findFileForNote,
      uploadNote,
    });
    expect(result).toEqual({ status: "synced", driveFileId: "new-file-id", lastSyncedAt: 1000 });
    // active フォルダの ntbKind で検索し、active フォルダ配下へ kind=active で上げる。
    expect(findFileForNote).toHaveBeenCalledWith("n1", "token-abc", undefined, "active");
    expect(uploadNote).toHaveBeenCalledWith(mdNote, "token-abc", null, undefined, ACTIVE_OPTS);
  });

  it("driveFileId既知なら検索をスキップして更新アップロードする", async () => {
    const withFileId: Note = { ...note, driveFileId: "existing-file" };
    const resolveFolderPath = vi.fn().mockResolvedValue("active-folder");
    const findFileForNote = vi.fn();
    const uploadNote = vi.fn().mockResolvedValue("existing-file");
    const result = await syncNoteToDrive(withFileId, 2000, false, {
      getAuthToken: vi.fn().mockResolvedValue("token-abc"),
      resolveFolderPath,
      findFileForNote,
      uploadNote,
    });
    expect(result).toEqual({ status: "synced", driveFileId: "existing-file", lastSyncedAt: 2000 });
    expect(findFileForNote).not.toHaveBeenCalled();
    expect(uploadNote).toHaveBeenCalledWith(
      { id: "n1", title: "会議メモ", content: noteToMarkdown(withFileId) },
      "token-abc",
      "existing-file",
      undefined,
      ACTIVE_OPTS,
    );
  });

  it("アップロード失敗はerrorステータスを返す", async () => {
    const result = await syncNoteToDrive(note, 1000, false, {
      getAuthToken: vi.fn().mockResolvedValue("token-abc"),
      resolveFolderPath: vi.fn().mockResolvedValue("active-folder"),
      findFileForNote: vi.fn().mockResolvedValue(null),
      uploadNote: vi.fn().mockRejectedValue(new Error("network down")),
    });
    expect(result).toEqual({ status: "error" });
  });
});
