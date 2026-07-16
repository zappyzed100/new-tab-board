// nasActiveSync.ts — タブ(ブラウザ)とNAS activeの「世代番号」ベース同期(ユーザー指示)。
// 5分毎(+初回編集時に所有権取得)に世代を突き合わせ、push(自分が最新)/pull(NASが新しい)を決める。
//   - 操作開始時: bump-generation で新世代=所有権を得る(nasOwner=true, localGen=新世代)。
//   - NASの世代 == 自分の世代 かつ 所有者: push(activeを上書き + 日付へ追記 + 消えたものを削除)。
//   - NASの世代 > 自分の世代: pull(NAS activeでタブのノートを上書き。最終操作者優先——ユーザー指示)。
import { readNasActive } from "./nasNativeHost";
import { getNasFolderPath } from "../storage/db";
import {
  markdownToNote,
  noteToMarkdown,
  reconcileActiveNotesOnNas,
  writeNoteToNasStructure,
} from "./nasArchive";
import { contentHash } from "../gemini/tagging";
import type { Note } from "../../types";

/** active/ファイルの書式バージョン。フォーマット(拡張子・構造)を変えるたびに上げ、
 * ノート本文が無変更でも保存済みハッシュキャッシュ(nasSavedHashes/driveActiveSavedHashes。
 * どちらもsaveLocalData経由でセッションをまたいで永続化される)を一度だけ無効化して再書き込み
 * させる。**"1"→"2"(2026-07-16)**: active/の拡張子を.mdから.txtへ変更した際、本文が無変更の
 * 既存ノートは(fpが本文だけのハッシュだったため)保存済み判定でスキップされ続け、旧.mdが
 * リネームされないまま新.txtが一切書かれない不具合になっていた(ユーザー報告「ドライブに退避
 * でactiveにファイルが出力されない」)。 */
const ACTIVE_FILE_FORMAT_VERSION = "2";

/** ノートの「保存フィンガープリント」= 保存する.md全体のハッシュ(ユーザー指示: ハッシュで保存済みか判定)。
 * noteToMarkdown はタイトル/本文/タグ/order/pinned/done/special等の永続フィールドだけを含む(driveFileId/
 * taggedHash等の揮発フィールドは含まない)ので、これ1つで「保存すべき変化があったか」を捉えられる。
 * ACTIVE_FILE_FORMAT_VERSIONを連結し、書式バージョンが変わったときも変化として検出する。
 *
 * ただし order は除外する(2026-07-16 是正): reorderNotes は並べ替えのたびに**全ノート**の order を
 * 0からの連番へ振り直すため、1回の「上へ」やドラッグ操作だけで全ノートのフィンガープリントが変わり、
 * 本文が1文字も変わっていないのに全ノートが active/日付フォルダへ無駄に再書き込みされていた
 * (ユーザー指摘「順番差し替えただけで作動するけど、順番変えても中身変わらないだろ」)。order は
 * 実際に書き込みが起きた時点の noteToMarkdown には最新値がそのまま入るため、他の理由で再書き込み
 * されれば追従する——常に最新ではなくなるが、内容不変の並べ替えで書き込みが起きないことを優先する。
 * pinned は除外しない: togglePinNote は1ノートだけを更新する独立した操作であり、並べ替えのように
 * 全ノートを巻き込まない正当な内容変化のため。 */
export function noteSaveFingerprint(note: Note): string {
  return contentHash(`${ACTIVE_FILE_FORMAT_VERSION}:${noteToMarkdown({ ...note, order: 0 })}`);
}

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
 * ノートを active から削除する。**保存フィンガープリントが前回と同じノートは書かない**(ユーザー指示:
 * ハッシュで保存済みか判定して無駄な再保存を避ける。日付フォルダも「その日に変わったノート」だけになる)。
 * savedHashes は id→前回保存時のフィンガープリント。更新後のマップと書込件数を返す(呼び出し側が永続化)。
 * NAS未設定なら writeNoteToNasStructure が静かにfalseで0件。 */
export async function pushActiveToNas(
  notes: Note[],
  now: number,
  savedHashes: Record<string, string>,
  deps: PushDeps = {},
): Promise<{ written: number; savedHashes: Record<string, string> }> {
  const _write = deps.writeNoteToNasStructure ?? writeNoteToNasStructure;
  const _reconcile = deps.reconcileActiveNotesOnNas ?? reconcileActiveNotesOnNas;
  const next: Record<string, string> = {};
  let written = 0;
  for (const n of notes) {
    if (n.content.trim() === "" || n.junk) continue; // 空・ゴミは保存対象外(ハッシュも捨てる)
    const fp = noteSaveFingerprint(n);
    if (savedHashes[n.id] === fp) {
      next[n.id] = fp; // 変更なし=保存済み。書かずにハッシュだけ引き継ぐ。
      continue;
    }
    if (await _write(n, now)) {
      next[n.id] = fp;
      written += 1;
    } else if (savedHashes[n.id] !== undefined) {
      next[n.id] = savedHashes[n.id]; // 書けなかった: 旧ハッシュ維持(次回再試行)
    }
  }
  await _reconcile(notes);
  return { written, savedHashes: next };
}
