// driveActiveMirror.ts — Google Drive の app/New Tab Board/active/ を「編集中のノート一覧」に
// 突き合わせる(ユーザー指示)。①空でないノートは per-note の syncNoteToDrive が active/ へ上げる。
// ②reconcileDriveActive は active/ にあってもう存在しない/空になったノートのファイルを削除する
// (ブラウザで消されたら Drive でも消す)。③copyNotesToDriveDateFolder は NAS と同一構造の日付
// フォルダ app/New Tab Board/YYYY/M/D/ へその日のコピーを格納する——こちらは**日次**の
// background ジョブから呼ぶ(ユーザー指示: Drive日付フォルダは一日一回)。ファイルは
// <id>.md(Markdown+front matter)。空ノートは上げない。
import { deleteDriveFile, listNoteFilesInFolder, resolveFolderPath, uploadNote } from "./drive";
import { ACTIVE_FOLDER_PATH } from "./driveSync";
import { noteToMarkdown, todosToMarkdown } from "../externalIO/nasArchive";
import { logOp } from "../runtime/log";
import type { Note, Todo } from "../../types";

const APP_ROOT = ["app", "New Tab Board"];
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const TODOS_FILENAME = "todos.txt";

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

  // 「この端末のみ(noSync)」は keep しない——過去に上がった active ファイルを Drive から削除する。
  const keepIds = new Set(
    notes.filter((n) => n.content.trim() !== "" && !n.noSync).map((n) => n.id),
  );

  logOp("driveActiveMirror", "resolve-folder-start", `path=${ACTIVE_FOLDER_PATH.join("/")}`);
  const activeFolder = await _resolve(ACTIVE_FOLDER_PATH, token);
  logOp("driveActiveMirror", "resolve-folder-done", `folderId=${activeFolder}`);
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

  const nonEmpty = notes.filter((n) => n.content.trim() !== "" && !n.junk && !n.noSync);
  const dateKind = `date:${dateFolderParts(dayMs).join("/")}`;
  const datePath = [...APP_ROOT, ...dateFolderParts(dayMs)];
  logOp("driveActiveMirror", "resolve-folder-start", `path=${datePath.join("/")}`);
  const dateFolder = await _resolve(datePath, token);
  logOp(
    "driveActiveMirror",
    "resolve-folder-done",
    `path=${datePath.join("/")} folderId=${dateFolder}`,
  );
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

async function findTodosFile(
  folderId: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const q = `'${folderId}' in parents and name='${TODOS_FILENAME}' and trashed=false`;
  const res = await fetchImpl(`${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive検索失敗: HTTP ${res.status}`);
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

export type PushTodosDeps = {
  resolveFolderPath?: typeof resolveFolderPath;
  fetchImpl?: typeof fetch;
};

/** TODO一覧をDriveのactive/todos.mdへ書く(ユーザー指示: TODOもactiveへ入れる。既存の
 * settings-backup.jsonとの二重管理でよい)。appPropertiesにnoteIdを持たせないため、
 * listNoteFilesInFolder(noteId持ちのファイルしか拾わない)経由のreconcileDriveActiveには
 * 一切引っかからず、ノートの「消えたら消す」突合で誤って削除されない。 */
export async function pushTodosToDriveActive(
  todos: Todo[],
  token: string,
  deps: PushTodosDeps = {},
): Promise<boolean> {
  const _resolve = deps.resolveFolderPath ?? resolveFolderPath;
  const _fetch = deps.fetchImpl ?? fetch;
  const folderId = await _resolve(ACTIVE_FOLDER_PATH, token);
  const existingId = await findTodosFile(folderId, token, _fetch);
  const content = todosToMarkdown(todos);
  const boundary = "newtabboard-todos";
  // mimeTypeはtext/plain(active/todos.txt)——text/markdownのままだとiPhoneのDriveアプリで
  // 「サポートされていないファイル形式です」となり開けなかった実機不具合の修正(2026-07-16。
  // uploadNoteのactive用と同じ理由)。新規作成だけでなく既存ファイルの更新でも毎回送り、
  // 以前text/markdownで作られていた既存ファイルも是正されるようにする。
  // trashedフィールドは新規作成では書き込み不可でHTTP 403になる(uploadNote/uploadBackupと
  // 同じ罠——ただしこの関数は名前+親で毎回検索するため、見つからない=作り直しになる方針で
  // よく、trashed復活ロジック自体を持たない)。
  const metadata: Record<string, unknown> = existingId
    ? { mimeType: "text/plain" }
    : { name: TODOS_FILENAME, mimeType: "text/plain", parents: [folderId] };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n` +
    `--${boundary}--`;
  const url = existingId
    ? `${UPLOAD_URL}/${existingId}?uploadType=multipart`
    : `${UPLOAD_URL}?uploadType=multipart`;
  const res = await _fetch(url, {
    method: existingId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    logOp("driveActiveMirror", "todos-upload-error", `status=${res.status}`);
    return false;
  }
  logOp("driveActiveMirror", "todos-upload", `mode=${existingId ? "update" : "create"}`);
  return true;
}
