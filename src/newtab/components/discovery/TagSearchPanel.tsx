// TagSearchPanel.tsx — タグでノートを絞り込むパネル(メモリ内・索引不要。tagSearch.tsの純粋ロジックを使う)
import { useState } from "react";
import { Badge, Button, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { filterNotesByTags, relatedTags, tagCounts } from "../../../lib/search/tagSearch";
import type { Note } from "../../../types";

type Props = {
  notes: Note[];
  onSelectNote: (noteId: string) => void;
};

export function TagSearchPanel({ notes, onSelectNote }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"and" | "or">("and");

  const counts = tagCounts(notes);
  if (counts.length === 0) return null; // タグがまだ無ければ何も出さない

  const matching = filterNotesByTags(notes, selected, mode);
  const related = relatedTags(notes, selected);

  function toggle(tag: string) {
    setSelected((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  return (
    <Card data-testid="tag-search-panel">
      <Flex align="center" gap="3" wrap="wrap" mb="2">
        <Heading as="h2" size="3">
          🏷️ タグで絞り込み
        </Heading>
        {selected.length >= 2 ? (
          <Button
            type="button"
            size="1"
            variant="soft"
            data-testid="tag-search-mode"
            title="複数タグの結合方法を切り替える(AND=全て含む / OR=いずれか)"
            onClick={() => setMode((m) => (m === "and" ? "or" : "and"))}
          >
            {mode === "and" ? "AND(全て含む)" : "OR(いずれか)"}
          </Button>
        ) : null}
      </Flex>

      <Flex gap="1" wrap="wrap">
        {counts.map(({ tag, count }) => {
          const isSelected = selected.includes(tag);
          return (
            <Badge
              key={tag}
              asChild
              color={isSelected ? "indigo" : "gray"}
              variant={isSelected ? "solid" : "soft"}
            >
              <button
                type="button"
                data-testid="tag-chip"
                data-tag={tag}
                aria-pressed={isSelected}
                style={{ cursor: "pointer" }}
                onClick={() => toggle(tag)}
              >
                {tag} {count}
              </button>
            </Badge>
          );
        })}
      </Flex>

      {selected.length > 0 ? (
        <>
          <Text as="p" size="1" color="gray" mt="2" data-testid="tag-search-count">
            一致 {matching.length}件
          </Text>
          <Flex direction="column" gap="1" mt="1" asChild>
            <ul>
              {matching.map((note) => (
                <li key={note.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    data-testid={`tag-search-result-${note.id}`}
                    onClick={() => onSelectNote(note.id)}
                  >
                    {note.title}
                  </Button>
                </li>
              ))}
            </ul>
          </Flex>
          {related.length > 0 ? (
            <Flex gap="1" wrap="wrap" mt="2" align="center">
              <Text size="1" color="gray">
                関連タグ:
              </Text>
              {related.map(({ tag, count }) => (
                <Badge key={tag} asChild color="gray" variant="outline">
                  <button
                    type="button"
                    data-testid="related-tag-chip"
                    data-tag={tag}
                    style={{ cursor: "pointer" }}
                    onClick={() => toggle(tag)}
                  >
                    {tag} {count}
                  </button>
                </Badge>
              ))}
            </Flex>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
