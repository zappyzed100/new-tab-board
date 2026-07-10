// driveSync.ts — ノート現行内容のDrive同期オーケストレーション(SPEC.md §4.2・§8)
// 履歴は上げない・現行内容のみ上書き。競合はlast-write-winsで単純化(SPEC.md §8)。
import { getAuthToken } from "./googleAuth";
import { findFileForNote, uploadNote } from "./drive";
import { logOp } from "./log";
import type { Note } from "../types";

export type SyncResult =
  | { status: "synced"; driveFileId: string; lastSyncedAt: number }
  | { status: "unauthenticated" }
  | { status: "error" };

export type SyncDeps = {
  getAuthToken?: typeof getAuthToken;
  findFileForNote?: typeof findFileForNote;
  uploadNote?: typeof uploadNote;
};

/** ノート1件をDriveへ同期する。未サインイン/未許可はunauthenticatedとして静かに返す
 * (interactive=falseでの日常同期時にユーザーへ毎回プロンプトを出さないため)。 */
export async function syncNoteToDrive(
  note: Note,
  now: number,
  interactive: boolean,
  deps: SyncDeps = {},
): Promise<SyncResult> {
  const _getAuthToken = deps.getAuthToken ?? getAuthToken;
  const _findFileForNote = deps.findFileForNote ?? findFileForNote;
  const _uploadNote = deps.uploadNote ?? uploadNote;

  const token = await _getAuthToken(interactive);
  if (!token) return { status: "unauthenticated" };

  try {
    const existingId = note.driveFileId ?? (await _findFileForNote(note.id, token));
    const fileId = await _uploadNote(note, token, existingId);
    return { status: "synced", driveFileId: fileId, lastSyncedAt: now };
  } catch (err) {
    logOp("driveSync", "sync-error", `note=${note.id}`, { error: err });
    return { status: "error" };
  }
}
