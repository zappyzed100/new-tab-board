// BacklinksPanel.tsx — 現在のノートへ[[リンク]]しているノート一覧(バックリンク。SPEC.md §7 v1確定)
import { Button, Flex, Heading } from "@radix-ui/themes";
import { Link2 } from "lucide-react";
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

  // バックリンクが無いときは何も出さない(「このノートへのリンクはありません」は邪魔——ユーザー指示)。
  if (backlinks.length === 0) return null;

  return (
    <>
      <Heading as="h2" size="3" className="panel-title">
        <Flex align="center" gap="1" as="span">
          <Link2 size={15} aria-hidden="true" />
          バックリンク([[{activeNote.title}]]にリンクしているノート)
        </Flex>
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
