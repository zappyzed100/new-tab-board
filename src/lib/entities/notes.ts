// notes.ts — ノートの純粋な状態更新関数(I/Oを持たない。SPEC.md §4.2)
import type { Note } from "../../types";

/** ノートの保持上限(ユーザー指示で26→501へ拡張)。A〜Z(26)を超えたらAA以降を解禁する。 */
export const MAX_NOTES = 501;
/** 横並び表示に含められる最大件数(ユーザー指示で3→上限まで。3列で下へ折り返して並ぶ)。 */
export const MAX_VISIBLE_NOTES = MAX_NOTES;

/** 1始まりの通し番号を、スプレッドシート列風の英字(1→A, 26→Z, 27→AA, 28→AB…)へ変換する。 */
function columnLetters(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** 「ノートA」「ノートB」…「ノートZ」「ノートAA」…のうち、既存タイトルと重複しない最初の1つを返す。
 * MAX_NOTES件すべて使用中ならnull(呼び出し側は新規作成を拒否しポップアップを出す)。 */
export function nextNoteLetterTitle(existingTitles: string[]): string | null {
  const used = new Set(existingTitles);
  for (let i = 1; i <= MAX_NOTES; i++) {
    const title = `ノート${columnLetters(i)}`;
    if (!used.has(title)) return title;
  }
  return null;
}

export function createNote(title: string, order: number): Note {
  return {
    id: crypto.randomUUID(),
    title,
    content: "",
    pinned: false,
    order,
  };
}

export function addNote(notes: Note[], note: Note): Note[] {
  return [...notes, note];
}

export function updateNote(notes: Note[], id: string, patch: Partial<Omit<Note, "id">>): Note[] {
  return notes.map((n) => (n.id === id ? { ...n, ...patch } : n));
}

export function removeNote(notes: Note[], id: string): Note[] {
  return notes.filter((n) => n.id !== id);
}

/** ピン留めを先頭に、それぞれorder昇順で並べたコピーを返す。 */
export function sortedNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.order - b.order;
  });
}

/** 表示順(sortedNotes基準)でfromIndexの要素をtoIndexへ移動し、orderを振り直す。 */
export function reorderNotes(notes: Note[], fromIndex: number, toIndex: number): Note[] {
  const sorted = sortedNotes(notes);
  const [moved] = sorted.splice(fromIndex, 1);
  sorted.splice(toIndex, 0, moved);
  return sorted.map((n, i) => ({ ...n, order: i }));
}

/** 横並び表示するノートIDを解決する(SPEC.md §4.2)。
 * ノートが3件以下なら全件を自動表示(選択不要)。4件以上ならrequestedIds(ユーザーが
 * チェックボックスで選んだもの)をそのままMAX_VISIBLE_NOTES件まで反映する——どの表示数でも
 * ユーザーの選択どおりにする(自動で埋め戻さない。削除済みIDはrequestedIdsから自然に除外)。
 * 表示は3列で下へ折り返して並ぶ(CSS側。ユーザー指示で「3件並んだ下にまた並べて」を繰り返す)。 */
export function resolveVisibleNoteIds(notes: Note[], requestedIds: string[]): string[] {
  const sorted = sortedNotes(notes);
  if (sorted.length <= 3) return sorted.map((n) => n.id);

  const validIds = new Set(sorted.map((n) => n.id));
  return requestedIds.filter((id) => validIds.has(id)).slice(0, MAX_VISIBLE_NOTES);
}
