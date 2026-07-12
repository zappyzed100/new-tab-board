// driveActiveMirror.ts — Google Drive の app/New Tab Board/active/ を「編集中のノート一覧」に
// 突き合わせる(ユーザー指示)。①空でないノートは per-note の syncNoteToDrive が active/ へ上げる。
// ②reconcileDriveActive は active/ にあってもう存在しない/空になったノートのファイルを削除する
// (ブラウザで消されたら Drive でも消す)。③copyNotesToDriveDateFolder は NAS と同一構造の日付
// フォルダ app/New Tab Board/YYYY/M/D/ へその日のコピーを格納する——こちらは**日次**の
// background ジョブから呼ぶ(ユーザー指示: Drive日付フォルダは一日一回)。ファイルは
// <id>.md(Markdown+front matter)。空ノートは上げない。
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

/** active/ を現在の非空ノート一覧へ突き合わせ、消えた/空になったノートのファイルを削除する。
 * 削除件数を返す。日付フォルダへの格納は copyNotesToDriveDateFolder(日次ジョブ)が担う。 */
export async function reconcileDriveActive(
  notes: Note[],
  token: string,
  deps: ReconcileDeps = {},
): Promise<{ deleted: number }> {
  const _resolve = deps.resolveFolderPath ?? resolveFolderPath;
  const _list = deps.listNoteFilesInFolder ?? listNoteFilesInFolder;
  const _delete = deps.deleteDriveFile ?? deleteDriveFile;

  const keepIds = new Set(notes.filter((n) => n.content.trim() !== "").map((n) => n.id));

  const activeFolder = await _resolve(ACTIVE_FOLDER_PATH, token);
  const activeFiles = await _list(activeFolder, token);
  let deleted = 0;
  for (const file of activeFiles) {
    if (!keepIds.has(file.noteId)) {
      await _delete(file.id, token);
      deleted += 1;
    }
  }

  logOp("driveActiveMirror", "reconcile", `deleted=${deleted}`);
  return { deleted };
}

/** 日付フォルダ app/New Tab Board/YYYY/M/D/ へ、その日のノートのコピー(<id>.md・Markdown+front
 * matter)を格納する(NASの日付フォルダと同一構造)。空ノートは上げない。dayMs はどの日の
 * フォルダへ入れるか(日次ジョブは「前日」を渡す——ユーザー指示)。格納件数を返す。 */
export async function copyNotesToDriveDateFolder(
  notes: Note[],
  dayMs: number,
  token: string,
  deps: ReconcileDeps = {},
): Promise<{ dated: number }> {
  const _resolve = deps.resolveFolderPath ?? resolveFolderPath;
  const _list = deps.listNoteFilesInFolder ?? listNoteFilesInFolder;
  const _upload = deps.uploadNote ?? uploadNote;

  const nonEmpty = notes.filter((n) => n.content.trim() !== "");
  const dateKind = `date:${dateFolderParts(dayMs).join("/")}`;
  const dateFolder = await _resolve([...APP_ROOT, ...dateFolderParts(dayMs)], token);
  const dateFiles = await _list(dateFolder, token);
  const dateIdByNote = new Map(dateFiles.map((f) => [f.noteId, f.id]));
  let dated = 0;
  for (const note of nonEmpty) {
    // NASと同一構造: <id>.md へ Markdown+front matter で書く。同日の既存ファイルは上書き。
    await _upload(
      { id: note.id, title: note.title, content: noteToMarkdown(note) },
      token,
      dateIdByNote.get(note.id) ?? null,
      undefined,
      { folderId: dateFolder, kind: dateKind, filename: `${note.id}.md` },
    );
    dated += 1;
  }

  logOp("driveActiveMirror", "date-archive", `day=${dateKind} dated=${dated}`);
  return { dated };
}
