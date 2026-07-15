// driveSpecial.ts — スペシャル(⭐)を Google Drive の app/New Tab Board/special/<folder>/<id>.md へ
// 書き出し、そのフォルダ内の消えた項目を削除する(ユーザー指示: スペシャルはNAS/Driveのspecialフォルダへ)。
// NASの specialSync と対。フォルダごとにまとめて解決→アップロード→そのフォルダ内で突き合わせ削除する。
import { deleteDriveFile, listNoteFilesInFolder, resolveFolderPath, uploadNote } from "./drive";
import { specialEntryToMarkdown } from "../externalIO/specialSync";
import { normalizeFolder, type SpecialEntry } from "../entities/special";
import { logOp } from "../runtime/log";

const SPECIAL_ROOT = ["app", "New Tab Board", "special"];

export type SpecialDriveDeps = {
  resolveFolderPath?: typeof resolveFolderPath;
  listNoteFilesInFolder?: typeof listNoteFilesInFolder;
  uploadNote?: typeof uploadNote;
  deleteDriveFile?: typeof deleteDriveFile;
};

/** スペシャルエントリを Drive の special/<folder>/<id>.md へ格納し、各フォルダ内で desired に無い
 * ファイルを削除する。アップロード/削除件数を返す。既知の割り切り: 全項目が抜けて空になった
 * フォルダは訪問しないため、そのフォルダの旧ファイルは残る(NAS側 specialSync は再帰listで掃除する)。 */
export async function pushSpecialToDrive(
  entries: SpecialEntry[],
  token: string,
  deps: SpecialDriveDeps = {},
): Promise<{ uploaded: number; deleted: number }> {
  const _resolve = deps.resolveFolderPath ?? resolveFolderPath;
  const _list = deps.listNoteFilesInFolder ?? listNoteFilesInFolder;
  const _upload = deps.uploadNote ?? uploadNote;
  const _delete = deps.deleteDriveFile ?? deleteDriveFile;

  // フォルダ(正規化)ごとにまとめる。
  const byFolder = new Map<string, SpecialEntry[]>();
  for (const e of entries) {
    const f = normalizeFolder(e.folder ?? "");
    const group = byFolder.get(f);
    if (group) group.push(e);
    else byFolder.set(f, [e]);
  }

  let uploaded = 0;
  let deleted = 0;
  for (const [folder, group] of byFolder) {
    const parts = folder ? [...SPECIAL_ROOT, ...folder.split("/")] : SPECIAL_ROOT;
    logOp("driveSpecial", "resolve-folder-start", `path=${parts.join("/")}`);
    const folderId = await _resolve(parts, token);
    logOp("driveSpecial", "resolve-folder-done", `path=${parts.join("/")} folderId=${folderId}`);
    const existing = await _list(folderId, token); // [{id, noteId}]
    const idToFile = new Map(existing.map((f) => [f.noteId, f.id]));
    const keep = new Set(group.map((e) => e.id));
    for (const e of group) {
      await _upload(
        { id: e.id, title: e.title, content: specialEntryToMarkdown(e) },
        token,
        idToFile.get(e.id) ?? null,
        undefined,
        { folderId, kind: `special:${folder}`, filename: `${e.id}.md` },
      );
      uploaded += 1;
    }
    for (const f of existing) {
      if (!keep.has(f.noteId)) {
        await _delete(f.id, token);
        deleted += 1;
      }
    }
  }
  return { uploaded, deleted };
}
