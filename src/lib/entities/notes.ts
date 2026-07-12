// notes.ts — ノートの純粋な状態更新関数(I/Oを持たない。SPEC.md §4.2)
import type { Note } from "../../types";

const NOTE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 「ノートA」〜「ノートZ」のうち既存タイトルと重複しない最初の1つを返す。
 * 全26文字が使用中ならnull(呼び出し側は新規作成を拒否しポップアップを出す)。 */
export function nextNoteLetterTitle(existingTitles: string[]): string | null {
  const used = new Set(existingTitles);
  for (const letter of NOTE_LETTERS) {
    const title = `ノート${letter}`;
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

/** 横並び表示する最大3件のノートIDを解決する(SPEC.md §4.2)。
 * ノートが3件以下なら全件を自動表示(選択不要)。4件以上ならrequestedIds(ユーザーが
 * チェックボックスで選んだ順)を優先しつつ、3件に満たない分は表示順の先頭から
 * 埋めて常に3件表示を維持する(削除済みIDはrequestedIdsから自然に除外される)。 */
export function resolveVisibleNoteIds(notes: Note[], requestedIds: string[]): string[] {
  const sorted = sortedNotes(notes);
  if (sorted.length <= 3) return sorted.map((n) => n.id);

  const validIds = new Set(sorted.map((n) => n.id));
  const result = requestedIds.filter((id) => validIds.has(id)).slice(0, 3);
  for (const note of sorted) {
    if (result.length >= 3) break;
    if (!result.includes(note.id)) result.push(note.id);
  }
  return result;
}
