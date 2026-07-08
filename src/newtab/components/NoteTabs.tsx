// NoteTabs.tsx — ノートのタブ切替UI(追加/リネーム/削除/ピン留め。SPEC.md §4.2)
import { useState } from "react";
import { addNote, createNote, removeNote, sortedNotes, updateNote } from "../../lib/notes";
import type { Note } from "../../types";

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
    const note = createNote("無題のノート", sorted.length);
    onNotesChange(addNote(notes, note));
    onSelect(note.id);
  }

  return (
    <div data-testid="note-tabs">
      {sorted.map((note) => (
        <div key={note.id} data-testid={`note-tab-${note.id}`}>
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
              onClick={() => onSelect(note.id)}
              onDoubleClick={() => setRenamingId(note.id)}
            >
              {note.pinned ? "📌 " : ""}
              {note.title}
            </button>
          )}
          <button
            type="button"
            data-testid={`note-tab-pin-${note.id}`}
            onClick={() => onNotesChange(updateNote(notes, note.id, { pinned: !note.pinned }))}
          >
            {note.pinned ? "ピン解除" : "ピン留め"}
          </button>
          <button
            type="button"
            data-testid={`note-tab-delete-${note.id}`}
            onClick={() => onNotesChange(removeNote(notes, note.id))}
          >
            削除
          </button>
        </div>
      ))}
      <button type="button" data-testid="note-tab-add" onClick={handleAdd}>
        + ノート
      </button>
    </div>
  );
}
