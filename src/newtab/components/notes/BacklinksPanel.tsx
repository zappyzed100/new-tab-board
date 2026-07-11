// BacklinksPanel.tsx — 現在のノートへ[[リンク]]しているノート一覧(バックリンク。SPEC.md §7 v1確定)
import { Button, Heading, Text } from "@radix-ui/themes";
import { buildBacklinkIndex } from "../../../lib/linking/links";
import type { Note } from "../../../types";

type Props = {
  notes: Note[];
  activeNote: Note;
  onSelectNote: (noteId: string) => void;
};

export function BacklinksPanel({ notes, activeNote, onSelectNote }: Props) {
  const index = buildBacklinkIndex(notes);
  const backlinks = index.get(activeNote.title) ?? [];

  if (backlinks.length === 0) {
    return (
      <Text as="p" data-testid="backlinks-empty" color="gray">
        🔗 このノートへのリンクはありません
      </Text>
    );
  }

  return (
    <>
      <Heading as="h2" size="3" className="panel-title">
        🔗 バックリンク([[{activeNote.title}]]にリンクしているノート)
      </Heading>
      <ul data-testid="backlinks-panel">
        {backlinks.map((link) => (
          <li key={link.fromNoteId} data-testid={`backlink-item-${link.fromNoteId}`}>
            <Button
              type="button"
              variant="soft"
              data-testid={`backlink-open-${link.fromNoteId}`}
              title={`「${link.fromNoteTitle}」を開く`}
              onClick={() => onSelectNote(link.fromNoteId)}
            >
              {link.fromNoteTitle}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
