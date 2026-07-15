// driveSync.test.ts — driveSync.ts(Drive同期オーケストレーション)の単体テスト
import { describe, expect, it, vi } from "vitest";
import { activeFilenameFor, syncNoteToDrive } from "./driveSync";
import { noteToMarkdown } from "../externalIO/nasArchive";
import type { Note } from "../../types";

const note: Note = { id: "n1", title: "会議メモ", content: "本文", pinned: false, order: 0 };
// active/<id>.md へは Markdown+front matter で書く(uploadNoteのcontentへmdを渡す)。
const mdNote = { id: note.id, title: note.title, content: noteToMarkdown(note) };
// Driveのactiveフォルダのファイル名はタイトルベース(ユーザー指示。中身のidは変わらない)。
const ACTIVE_OPTS = {
  folderId: "active-folder",
  kind: "active",
  filename: activeFilenameFor(note),
};

describe("activeFilenameFor", () => {
  it("<タイトル> (idの先頭8桁).md にする(ユーザー指示: Driveで見て分かる名前にしたい)", () => {
    expect(
      activeFilenameFor({ id: "3040f49a-50c5-4439-bd10-0c29e6db1333", title: "会議メモ" }),
    ).toBe("会議メモ (3040f49a).md");
  });

  it("空タイトルは(無題)にする", () => {
    expect(activeFilenameFor({ id: "abcdefgh-0000", title: "  " })).toBe("(無題) (abcdefgh).md");
  });

  it("改行・スラッシュを含むタイトルは一行の見苦しくない形にする", () => {
    expect(activeFilenameFor({ id: "12345678-0000", title: "会議\nメモ/議事録" })).toBe(
      "会議 メモ-議事録 (12345678).md",
    );
  });

  it("同じタイトルでもidが違えばファイル名は衝突しない", () => {
    const a = activeFilenameFor({ id: "aaaaaaaa-0000", title: "無題" });
    const b = activeFilenameFor({ id: "bbbbbbbb-0000", title: "無題" });
    expect(a).not.toBe(b);
  });
});

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
