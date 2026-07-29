// BacklinksPanel.tsx — 現在のノートへ[[リンク]]しているノート一覧(バックリンク。SPEC.md §7 v1確定)
import { useMemo } from "react";
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
  // notesが変わらない限り作り直さない(2026-07-29)。このパネルはマウント中の**全ペイン**に
  // 1つずつ置かれるため、素で呼ぶとAppが1回再レンダするたびに O(ペイン数 × 全ノート本文長)
  // の正規表現走査になる(Appの再レンダは背景タブでも5分ごとに起きる——backgroundが
  // driveConnectedを書くたびApp側が無条件setStateするため)。
  // **ただしこれは「長時間タスクの原因」ではない**: 実測(ノート31件・本文計428KB・
  // マウント3ペイン)で1回0.29ms、1レンダ0.88ms、1時間ぶん合計しても11msだった。
  // [[...]]は否定文字クラスだけの正規表現でV8が即座に失敗判定するため速い。
  // 計算量が素直に増える形なのは確かなので予防として残すが、重さの説明にはならない。
  const index = useMemo(() => buildBacklinkIndex(notes), [notes]);
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
