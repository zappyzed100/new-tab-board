// nasActiveSync.ts — タブ(ブラウザ)とNAS activeの「世代番号」ベース同期(ユーザー指示)。
// 5分毎(+初回編集時に所有権取得)に世代を突き合わせ、push(自分が最新)/pull(NASが新しい)を決める。
//   - 操作開始時: bump-generation で新世代=所有権を得る(nasOwner=true, localGen=新世代)。
//   - NASの世代 == 自分の世代 かつ 所有者: push(activeを上書き + 日付へ追記 + 消えたものを削除)。
//   - NASの世代 > 自分の世代: pull(NAS activeでタブのノートを上書き。最終操作者優先——ユーザー指示)。
import { readNasActive } from "./nasNativeHost";
import { getNasFolderPath } from "../storage/db";
import { markdownToNote, reconcileActiveNotesOnNas, writeNoteToNasStructure } from "./nasArchive";
import type { Note } from "../../types";

export type SyncDecision = "push" | "pull" | "noop";

/** 世代番号と所有権から、今回のtickで push / pull / 何もしない のどれかを決める純関数。
 * - NASの方が新しい(nasGen > localGen)→ pull(常に。最終操作者優先で上書き)。
 * - 自分が所有者で世代一致 → push(自分の変更をNASへ反映)。
 * - それ以外(受動・同世代/自分が先行)→ noop。 */
export function decideActiveSync(localGen: number, nasGen: number, owner: boolean): SyncDecision {
  if (nasGen > localGen) return "pull";
  if (owner && nasGen === localGen) return "push";
  return "noop";
}

export type PullDeps = {
  getNasFolderPath?: () => Promise<string | undefined>;
  readNasActive?: typeof readNasActive;
};

/** pull: NAS active の .md を読み、Note[](order昇順)へ復元する。NAS未設定/到達不可はnull。 */
export async function pullActiveFromNas(deps: PullDeps = {}): Promise<Note[] | null> {
  const path = await (deps.getNasFolderPath ?? getNasFolderPath)();
  if (!path) return null;
  const files = await (deps.readNasActive ?? readNasActive)(path);
  if (files === null) return null;
  // ファイル名順の index を fallback order にしつつ、front matter の order で最終的に並べる。
  const notes = files.map((f, i) => markdownToNote(f.content, i));
  notes.sort((a, b) => a.order - b.order);
  return notes;
}

export type PushDeps = {
  writeNoteToNasStructure?: typeof writeNoteToNasStructure;
  reconcileActiveNotesOnNas?: typeof reconcileActiveNotesOnNas;
};

/** push: 現在の非空・非junkノートを active/<id>.md と 日付フォルダへ書き、消えた/空になった
 * ノートを active から削除する。書き込めた件数を返す(NAS未設定なら writeNoteToNasStructure が
 * 静かにfalseで0件)。 */
export async function pushActiveToNas(
  notes: Note[],
  now: number,
  deps: PushDeps = {},
): Promise<number> {
  const _write = deps.writeNoteToNasStructure ?? writeNoteToNasStructure;
  const _reconcile = deps.reconcileActiveNotesOnNas ?? reconcileActiveNotesOnNas;
  let written = 0;
  for (const n of notes) {
    if (n.content.trim() === "" || n.junk) continue;
    if (await _write(n, now)) written += 1;
  }
  await _reconcile(notes);
  return written;
}
