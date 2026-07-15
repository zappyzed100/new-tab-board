// driveSync.ts — ノート現行内容のDrive同期オーケストレーション(SPEC.md §4.2・§8)
// 履歴は上げない・現行内容のみ上書き。競合はlast-write-winsで単純化(SPEC.md §8)。
import { getAuthToken } from "./googleAuth";
import { findFileForNote, resolveFolderPath, uploadNote } from "./drive";
import { noteToMarkdown } from "../externalIO/nasArchive";
import { logOp } from "../runtime/log";
import type { Note } from "../../types";

/** Drive上の「現在編集中のノート」を置くフォルダ(ユーザー指示: app/New Tab Board/active/)。 */
export const ACTIVE_FOLDER_PATH = ["app", "New Tab Board", "active"];
/** active フォルダのファイルを区別する appProperties の種別(日付フォルダのファイルと分けるため)。 */
export const ACTIVE_KIND = "active";

/** Driveのファイル名として見苦しくない一行にする(改行除去・パス区切りに見える文字を置換)。 */
function sanitizeDriveFilenamePart(title: string): string {
  const oneLine = title.replace(/[\r\n]+/g, " ").trim();
  const noSlash = oneLine.replace(/[/\\]/g, "-");
  return noSlash === "" ? "(無題)" : noSlash;
}

/** activeフォルダのファイル名(ユーザー指示: <タイトル>.mdにする。ただし同じタイトルの
 * ノートが複数あってもDrive上で衝突・見分けがつかなくならないよう、末尾にnoteIdの短い
 * 断片を付ける)。 */
export function activeFilenameFor(note: { id: string; title: string }): string {
  return `${sanitizeDriveFilenamePart(note.title)} (${note.id.slice(0, 8)}).md`;
}

export type SyncResult =
  | { status: "synced"; driveFileId: string; lastSyncedAt: number }
  | { status: "skipped-empty" }
  | { status: "unauthenticated" }
  | { status: "error" };

export type SyncDeps = {
  getAuthToken?: typeof getAuthToken;
  findFileForNote?: typeof findFileForNote;
  uploadNote?: typeof uploadNote;
  resolveFolderPath?: typeof resolveFolderPath;
};

/** ノート1件をDriveの active フォルダへ同期する。空ノートはアップロードしない(ユーザー指示)。
 * 未サインイン/未許可はunauthenticatedとして静かに返す(日常同期でプロンプトを出さないため)。 */
export async function syncNoteToDrive(
  note: Note,
  now: number,
  interactive: boolean,
  deps: SyncDeps = {},
): Promise<SyncResult> {
  // 空ファイルはDriveへ上げない(ユーザー指示)。既存ファイルの削除は board 側の突合で行う。
  if (note.content.trim() === "") return { status: "skipped-empty" };

  const _getAuthToken = deps.getAuthToken ?? getAuthToken;
  const _findFileForNote = deps.findFileForNote ?? findFileForNote;
  const _uploadNote = deps.uploadNote ?? uploadNote;
  const _resolveFolderPath = deps.resolveFolderPath ?? resolveFolderPath;

  const token = await _getAuthToken(interactive);
  if (!token) return { status: "unauthenticated" };

  try {
    const folderId = await _resolveFolderPath(ACTIVE_FOLDER_PATH, token);
    const existingId =
      note.driveFileId ?? (await _findFileForNote(note.id, token, undefined, ACTIVE_KIND));
    // ファイル内容(front matter付きmd)はNASのactive/<id>.mdと同一構造だが、Driveのファイル名
    // だけは<タイトル> (短いid).md にする(ユーザー指示: Drive上で見て分かる名前にしたい)。
    // 中身のidは今までどおり保つのでfindFileForNote等の検索・突合には影響しない。
    const fileId = await _uploadNote(
      { id: note.id, title: note.title, content: noteToMarkdown(note) },
      token,
      existingId,
      undefined,
      { folderId, kind: ACTIVE_KIND, filename: activeFilenameFor(note) },
    );
    return { status: "synced", driveFileId: fileId, lastSyncedAt: now };
  } catch (err) {
    logOp("driveSync", "sync-error", `note=${note.id}`, { error: err });
    return { status: "error" };
  }
}
