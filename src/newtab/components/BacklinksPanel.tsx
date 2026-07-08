// BacklinksPanel.tsx — 現在のノートへ[[リンク]]しているノート一覧(バックリンク。SPEC.md §7 v1確定)
import { buildBacklinkIndex } from "../../lib/links";
import type { Note } from "../../types";

type Props = {
  notes: Note[];
  activeNote: Note;
  onSelectNote: (noteId: string) => void;
};

export function BacklinksPanel({ notes, activeNote, onSelectNote }: Props) {
  const index = buildBacklinkIndex(notes);
  const backlinks = index.get(activeNote.title) ?? [];

  if (backlinks.length === 0) {
    return <p data-testid="backlinks-empty">このノートへのリンクはありません</p>;
  }

  return (
    <ul data-testid="backlinks-panel">
      {backlinks.map((link) => (
        <li key={link.fromNoteId} data-testid={`backlink-item-${link.fromNoteId}`}>
          <button
            type="button"
            data-testid={`backlink-open-${link.fromNoteId}`}
            onClick={() => onSelectNote(link.fromNoteId)}
          >
            {link.fromNoteTitle}
          </button>
        </li>
      ))}
    </ul>
  );
}
