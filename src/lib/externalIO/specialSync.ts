// specialSync.ts — スペシャル(⭐)をNASの special/<folder>/<id>.md へ書き出し、消えたものを削除する
// (ユーザー指示: スペシャルはNAS/Driveの special フォルダに入れる)。5分毎の同期push(所有者時)から呼ぶ。
import { deleteFileFromNas, listNasTree, writeFileToNas } from "./nasNativeHost";
import { noteToMarkdown } from "./nasArchive";
import { getNasFolderPath } from "../storage/db";
import { normalizeFolder, type SpecialEntry } from "../entities/special";
import type { Note } from "../../types";

/** special/ 配下の相対パス(listNasTreeが返す形式に合わせる。フォルダ無しはルート直下)。 */
export function specialRelPath(entry: { id: string; folder?: string }): string {
  const folder = normalizeFolder(entry.folder ?? "");
  return folder ? `${folder}/${entry.id}.md` : `${entry.id}.md`;
}

/** スペシャルエントリを Markdown+front matter にする(noteToMarkdown を流用)。 */
export function specialEntryToMarkdown(entry: SpecialEntry): string {
  const note: Note = {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    tags: entry.tags,
    pinned: false,
    order: 0,
    special: true,
    specialFolder: entry.folder,
  };
  return noteToMarkdown(note);
}

export type SpecialNasDeps = {
  getNasFolderPath?: () => Promise<string | undefined>;
  writeFileToNas?: typeof writeFileToNas;
  listNasTree?: typeof listNasTree;
  deleteFileFromNas?: typeof deleteFileFromNas;
};

/** NASの special/ を現在のスペシャルエントリへ突き合わせる: 各エントリを書き、desiredに無い .md を消す
 * (フォルダ移動で旧パスに残ったファイルもこれで消える)。書込/削除件数を返す。NAS未設定は0件。 */
export async function pushSpecialToNas(
  entries: SpecialEntry[],
  deps: SpecialNasDeps = {},
): Promise<{ written: number; deleted: number }> {
  const path = await (deps.getNasFolderPath ?? getNasFolderPath)();
  if (!path) return { written: 0, deleted: 0 };
  const _write = deps.writeFileToNas ?? writeFileToNas;
  const _list = deps.listNasTree ?? listNasTree;
  const _delete = deps.deleteFileFromNas ?? deleteFileFromNas;

  const desired = new Map<string, string>(); // special/配下の相対パス -> md
  for (const e of entries) desired.set(specialRelPath(e), specialEntryToMarkdown(e));

  let written = 0;
  for (const [rel, md] of desired) {
    if (await _write(path, `special/${rel}`, md)) written += 1;
  }
  // 突き合わせ削除(desiredに無い special/ 配下の .md を消す)。
  const actual = await _list(path, "special");
  let deleted = 0;
  if (actual) {
    for (const rel of actual) {
      if (!desired.has(rel) && (await _delete(path, `special/${rel}`))) deleted += 1;
    }
  }
  return { written, deleted };
}
