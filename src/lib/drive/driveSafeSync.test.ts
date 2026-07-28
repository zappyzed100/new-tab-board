// driveSafeSync.test.ts — Drive安全同期が片側だけのノートを保持し明示削除だけを反映する回帰
import { describe, expect, it, vi } from "vitest";
import type { Note } from "../../types";
import { syncDriveNotesSafely } from "./driveSafeSync";

function note(id: string, content: string, updatedAt: number): Note {
  return { id, title: id, content, pinned: false, order: 0, createdAt: 1, updatedAt };
}

describe("syncDriveNotesSafely", () => {
  it("別PCだけにあるノートを和集合へ取り込み、マージ後にだけactive突合する", async () => {
    const reconcile = vi.fn().mockResolvedValue({ deleted: 0 });
    const syncNote = vi.fn().mockResolvedValue({
      status: "synced",
      driveFileId: "uploaded-a",
      lastSyncedAt: 100,
    });
    const result = await syncDriveNotesSafely([note("a", "A", 10)], {}, "token", 100, {
      pullActiveFromDrive: vi.fn().mockResolvedValue([note("b", "B", 20)]),
      resolveFolderPath: vi.fn().mockResolvedValue("tombstone-folder"),
      listNoteFilesInFolder: vi.fn().mockResolvedValue([]),
      downloadFileContent: vi.fn(),
      uploadNote: vi.fn(),
      syncNoteToDrive: syncNote,
      reconcileDriveActive: reconcile,
    });

    expect(result?.notes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(syncNote).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0].map((n: Note) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("Driveのtombstoneが古いノートを削除する", async () => {
    const result = await syncDriveNotesSafely([note("gone", "old", 10)], {}, "token", 100, {
      pullActiveFromDrive: vi.fn().mockResolvedValue([note("gone", "old", 10)]),
      resolveFolderPath: vi.fn().mockResolvedValue("tombstone-folder"),
      listNoteFilesInFolder: vi.fn().mockResolvedValue([{ id: "t1", noteId: "gone" }]),
      downloadFileContent: vi
        .fn()
        .mockResolvedValue(JSON.stringify({ noteId: "gone", deletedAt: 20 })),
      uploadNote: vi.fn(),
      syncNoteToDrive: vi.fn(),
      reconcileDriveActive: vi.fn().mockResolvedValue({ deleted: 1 }),
    });

    expect(result).toEqual({ notes: [], tombstones: { gone: 20 } });
  });

  it("HTTP 401で失敗すればトークンを無効化してnullを返す(死んだトークンの再利用を防ぐ)", async () => {
    const invalidateOnAuthError = vi.fn();
    const authError = new Error("Drive検索失敗: HTTP 401");
    const result = await syncDriveNotesSafely([note("a", "A", 10)], {}, "token", 100, {
      pullActiveFromDrive: vi.fn().mockRejectedValue(authError),
      invalidateOnAuthError,
    });

    expect(result).toBeNull();
    expect(invalidateOnAuthError).toHaveBeenCalledWith(authError, "token");
  });
});
