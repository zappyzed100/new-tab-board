// driveActiveMirror.ts — Google Drive の app/New Tab Board/active/ を「編集中のノート一覧」に
// 突き合わせる(ユーザー指示)。①空でないノートは per-note の syncNoteToDrive が active/ へ上げる。
// ②ここでは active/ にあってもう存在しない/空になったノートのファイルを削除する(ブラウザで
// 消されたら Drive でも消す)。③さらに NAS と同一構造の日付フォルダ app/New Tab Board/YYYY/M/D/ へ
// その日のコピーも格納する。ファイルは <id>.md(Markdown+front matter)。空ノートは上げない。
import { deleteDriveFile, listNoteFilesInFolder, resolveFolderPath, uploadNote } from "./drive";
import { ACTIVE_FOLDER_PATH } from "./driveSync";
import { noteToMarkdown } from "../externalIO/nasArchive";
import { logOp } from "../runtime/log";
import type { Note } from "../../types";

const APP_ROOT = ["app", "New Tab Board"];

/** epoch ms を YYYY/M/D(4桁年・非ゼロ埋め。NASと同一書式)のパス片にする(例: 2026/7/13)。 */
export function dateFolderParts(ms: number): string[] {
  const d = new Date(ms);
  return [String(d.getFullYear()), String(d.getMonth() + 1), String(d.getDate())];
}

export type ReconcileDeps = {
  resolveFolderPath?: typeof resolveFolderPath;
  listNoteFilesInFolder?: typeof listNoteFilesInFolder;
  deleteDriveFile?: typeof deleteDriveFile;
  uploadNote?: typeof uploadNote;
};

/** active/ を現在の非空ノート一覧へ突き合わせ(消えた/空になったノートのファイルを削除)、
 * 日付フォルダへその日のコピーを格納する。削除件数・日付格納件数を返す。 */
export async function reconcileDriveActive(
  notes: Note[],
  now: number,
  token: string,
  deps: ReconcileDeps = {},
): Promise<{ deleted: number; dated: number }> {
  const _resolve = deps.resolveFolderPath ?? resolveFolderPath;
  const _list = deps.listNoteFilesInFolder ?? listNoteFilesInFolder;
  const _delete = deps.deleteDriveFile ?? deleteDriveFile;
  const _upload = deps.uploadNote ?? uploadNote;

  const nonEmpty = notes.filter((n) => n.content.trim() !== "");
  const keepIds = new Set(nonEmpty.map((n) => n.id));

  // ① active/ の突き合わせ削除(現在の非空ノートに無いファイル=消された/空になったノート)。
  const activeFolder = await _resolve(ACTIVE_FOLDER_PATH, token);
  const activeFiles = await _list(activeFolder, token);
  let deleted = 0;
  for (const file of activeFiles) {
    if (!keepIds.has(file.noteId)) {
      await _delete(file.id, token);
      deleted += 1;
    }
  }

  // ② 日付フォルダ app/New Tab Board/YY/MM/DD/ へその日のコピー(空ノートは上げない)。
  const dateKind = `date:${dateFolderParts(now).join("/")}`;
  const dateFolder = await _resolve([...APP_ROOT, ...dateFolderParts(now)], token);
  const dateFiles = await _list(dateFolder, token);
  const dateIdByNote = new Map(dateFiles.map((f) => [f.noteId, f.id]));
  let dated = 0;
  for (const note of nonEmpty) {
    // NASと同一構造: <id>.md へ Markdown+front matter で書く。
    await _upload(
      { id: note.id, title: note.title, content: noteToMarkdown(note) },
      token,
      dateIdByNote.get(note.id) ?? null,
      undefined,
      { folderId: dateFolder, kind: dateKind, filename: `${note.id}.md` },
    );
    dated += 1;
  }

  logOp("driveActiveMirror", "reconcile", `deleted=${deleted} dated=${dated}`);
  return { deleted, dated };
}
