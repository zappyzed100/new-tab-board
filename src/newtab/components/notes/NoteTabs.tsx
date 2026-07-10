// NoteTabs.tsx — ノートのタブ切替UI(追加/リネーム/削除。SPEC.md §4.2)
// エディタアプリのタブ(例: メモ帳)を踏襲し、削除はタブ上の×、追加はプレーンな+のみ。
// ピン留め機能のUIは撤去済み(データ上のnote.pinned/sortedNotesの並び順ロジック自体は
// 互換性のため維持——インポートしたデータのpinned:trueも並び順には反映され続ける)。
import { useState } from "react";
import {
  addNote,
  createNote,
  nextNoteLetterTitle,
  removeNote,
  sortedNotes,
  updateNote,
} from "../../../lib/entities/notes";
import type { Note } from "../../../types";

type Props = {
  notes: Note[];
  activeNoteId: string | null;
  onNotesChange: (notes: Note[]) => void;
  onSelect: (noteId: string) => void;
};

export function NoteTabs({ notes, activeNoteId, onNotesChange, onSelect }: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const sorted = sortedNotes(notes);

  function handleAdd() {
    const title = nextNoteLetterTitle(notes.map((n) => n.title));
    if (title === null) {
      window.alert("ノートを開きすぎです!(ノートA〜Zの26件が上限です)");
      return;
    }
    const note = createNote(title, sorted.length);
    onNotesChange(addNote(notes, note));
    onSelect(note.id);
  }

  return (
    <div data-testid="note-tabs">
      {sorted.map((note) => (
        <div key={note.id} data-testid={`note-tab-${note.id}`} className="note-tab">
          {renamingId === note.id ? (
            <input
              aria-label="ノート名"
              data-testid={`note-tab-rename-input-${note.id}`}
              defaultValue={note.title}
              onBlur={(e) => {
                onNotesChange(updateNote(notes, note.id, { title: e.target.value || note.title }));
                setRenamingId(null);
              }}
            />
          ) : (
            <button
              type="button"
              data-testid={`note-tab-select-${note.id}`}
              aria-current={note.id === activeNoteId}
              title="ダブルクリックでノート名を変更できます"
              onClick={() => onSelect(note.id)}
              onDoubleClick={() => setRenamingId(note.id)}
            >
              {note.title}
            </button>
          )}
          <button
            type="button"
            data-testid={`note-tab-delete-${note.id}`}
            className="note-tab-close"
            title="このノートを削除する"
            onClick={() => onNotesChange(removeNote(notes, note.id))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid="note-tab-add"
        className="note-tab-add"
        title="新しいノートを作成する"
        onClick={handleAdd}
      >
        +
      </button>
    </div>
  );
}
