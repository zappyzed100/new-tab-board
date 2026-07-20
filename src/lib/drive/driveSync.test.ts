// driveSync.test.ts — driveSync.ts(Drive同期オーケストレーション)の単体テスト
import { describe, expect, it, vi } from "vitest";
import { activeFilenameFor, resetDriveSyncState, syncNoteToDrive } from "./driveSync";
import { noteToMarkdown } from "../externalIO/nasArchive";
import type { Note } from "../../types";

const note: Note = { id: "n1", title: "会議メモ", content: "本文", pinned: false, order: 0 };
// active/<タイトル> (id8桁).txt へは Markdown+front matter で書く(uploadNoteのcontentへmdを渡す。
// 拡張子だけ.txtで中身は無変更)。
const mdNote = { id: note.id, title: note.title, content: noteToMarkdown(note) };
// Driveのactiveフォルダのファイル名はタイトルベース(ユーザー指示。中身のidは変わらない)。
// mimeTypeはtext/plain(iPhoneのDriveアプリでtext/markdownが開けなかった実機不具合の修正)。
const ACTIVE_OPTS = {
  folderId: "active-folder",
  kind: "active",
  filename: activeFilenameFor(note),
  mimeType: "text/plain",
};

describe("activeFilenameFor", () => {
  it("<タイトル> (idの先頭8桁).txt にする(ユーザー指示: Driveで見て分かる名前にしたい)", () => {
    expect(
      activeFilenameFor({ id: "3040f49a-50c5-4439-bd10-0c29e6db1333", title: "会議メモ" }),
    ).toBe("会議メモ (3040f49a).txt");
  });

  it("空タイトルは(無題)にする", () => {
    expect(activeFilenameFor({ id: "abcdefgh-0000", title: "  " })).toBe("(無題) (abcdefgh).txt");
  });

  it("改行・スラッシュを含むタイトルは一行の見苦しくない形にする", () => {
    expect(activeFilenameFor({ id: "12345678-0000", title: "会議\nメモ/議事録" })).toBe(
      "会議 メモ-議事録 (12345678).txt",
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

describe("同一ノートの同時同期(重複ファイル生成の防止)", () => {
  // 実害の型(2026-07-20): 「既存を探す→無ければ作る」はcheck-then-actのため、複数ペイン/
  // タブ/前景復帰の同期が同時に走ると両方が「無い」と判断してPOSTし、同一noteIdのファイルが
  // Drive上に2つできた。findFileForNoteはfiles[0]しか返さないので片方は永久に取り残され、
  // さらにそこからpullすると同じidのNoteが2件生まれて本文が混ざる。
  function makeDeps() {
    let created = 0;
    const findFileForNote = vi.fn(async () => null); // Drive上にはまだ無い(検索は常に空)
    const uploadNote = vi.fn(async (_n, _t, existingFileId: string | null) => {
      if (!existingFileId) created += 1;
      return "file-1";
    });
    return {
      created: () => created,
      deps: {
        getAuthToken: vi.fn(async () => "tok"),
        resolveFolderPath: vi.fn(async () => "active-folder"),
        findFileForNote,
        uploadNote,
      } as never,
      uploadNote,
    };
  }

  it("回帰: 同じノートを同時に同期しても新規作成は1回だけ", async () => {
    const { deps, created, uploadNote } = makeDeps();
    resetDriveSyncState();
    await Promise.all([
      syncNoteToDrive(note, 1, false, deps),
      syncNoteToDrive(note, 2, false, deps),
      syncNoteToDrive(note, 3, false, deps),
    ]);
    expect(uploadNote).toHaveBeenCalledTimes(3); // 3回とも上げるが…
    expect(created()).toBe(1); // …新規作成は1回だけ(残りは既存の更新)
  });

  it("回帰: 連続した同期でもDrive検索の結果整合を待たず既存IDを引く", async () => {
    // 検索は常に空を返す(作成直後のファイルが検索に出ない状態の再現)。それでも
    // メモリキャッシュがあるため2回目は新規作成にならない。
    const { deps, created } = makeDeps();
    resetDriveSyncState();
    await syncNoteToDrive(note, 1, false, deps);
    await syncNoteToDrive(note, 2, false, deps);
    expect(created()).toBe(1);
  });

  it("空ノートは直列化チェーンに乗せずskipped-emptyを返す", async () => {
    const { deps } = makeDeps();
    resetDriveSyncState();
    const result = await syncNoteToDrive({ ...note, content: "  " }, 1, false, deps);
    expect(result).toEqual({ status: "skipped-empty" });
  });
});
