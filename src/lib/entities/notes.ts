// notes.ts — ノートの純粋な状態更新関数(I/Oを持たない。SPEC.md §4.2)
import type { Note } from "../../types";

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
