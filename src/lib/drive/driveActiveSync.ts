// driveActiveSync.ts — Drive active/ とタブの世代同期のpull側(NAS側 nasActiveSync.ts の鏡像)。
//
// push/pull の判定そのものは nasActiveSync.ts の decideActiveSync をそのまま使う(同じ規則を
// 二重に書かない——世代番号は driveGeneration.ts の app/New Tab Board/data/generation.txt)。
// この方式を採る理由は、**削除の伝播に tombstone が要らない**こと: pull は「Drive上のactive/が
// そのまま正本」としてタブのノート集合を置き換えるため、片方で消したノートは相手側でも自然に
// 消える。Note型に削除マーカーを足す必要がない(2026-07-20設計)。
//
// 【重要な前提】pullを入れるまで、reconcileDriveActive(ローカルに無いDriveファイルを消す)は
// **ノート集合が変わるたび無条件に**走っていた。2台目のPCはまだ相手のノートを持っていないため、
// これは「相手のノートを消す」動作になる。pullを配線する時は、reconcileを push 判定の下へ
// 移すこと(NAS側の pushActiveToNas が reconcileActiveNotesOnNas を内包しているのと同じ形)。
import {
  downloadFileContent,
  listNoteFilesInFolder,
  resolveFolderPath,
  type FetchLike,
} from "./drive";
import { ACTIVE_FOLDER_PATH } from "./driveSync";
import { markdownToNote } from "../externalIO/nasArchive";
import { logOp } from "../runtime/log";
import type { Note } from "../../types";

export type DrivePullDeps = {
  resolveFolderPath?: typeof resolveFolderPath;
  listNoteFilesInFolder?: typeof listNoteFilesInFolder;
  downloadFileContent?: typeof downloadFileContent;
  fetchImpl?: FetchLike;
};

/** pull: Drive の active/ を読み、Note[](order昇順)へ復元する。未接続/失敗はnull
 * (呼び出し側は「今回は何もしない」として次のtickへ回す——静かに諦める既存方針と同じ)。
 *
 * ノートidは**appPropertiesのnoteIdを正本にする**(front matterのidではなく)。markdownToNote は
 * front matter に id が無ければ乱数を振るため、それをそのまま採ると pull のたびに別ノート扱いに
 * なり、盤面に同じノートが増殖したうえ Drive 側のファイル突合(noteIdで探す)とも食い違う。
 * Drive にはファイル属性として確実な noteId があるので、そちらで上書きする。 */
export async function pullActiveFromDrive(
  token: string,
  deps: DrivePullDeps = {},
): Promise<Note[] | null> {
  const _resolve = deps.resolveFolderPath ?? resolveFolderPath;
  const _list = deps.listNoteFilesInFolder ?? listNoteFilesInFolder;
  const _download = deps.downloadFileContent ?? downloadFileContent;

  try {
    logOp("driveActiveSync", "pull-start", `path=${ACTIVE_FOLDER_PATH.join("/")}`);
    const folderId = await _resolve(ACTIVE_FOLDER_PATH, token, deps.fetchImpl);
    const files = await _list(folderId, token, deps.fetchImpl); // noteIdを持つファイルだけ(todos.txtは除外)
    const notes: Note[] = [];
    for (const [i, file] of files.entries()) {
      const md = await _download(file.id, token, deps.fetchImpl);
      const note = markdownToNote(md, i);
      notes.push({ ...note, id: file.noteId, driveFileId: file.id });
    }
    notes.sort((a, b) => a.order - b.order);
    logOp("driveActiveSync", "pull-done", `folderId=${folderId} notes=${notes.length}`);
    return notes;
  } catch (err) {
    logOp("driveActiveSync", "pull-error", "", { error: err });
    return null;
  }
}
