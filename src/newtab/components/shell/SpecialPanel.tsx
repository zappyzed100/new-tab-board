// SpecialPanel.tsx — ⭐スペシャル(保管棚)のサイドバーカード。スター済みノート(live)と
// 削除で凍結した項目(frozen)を一覧する。タグの出現回数降順チップ+自由入力でタグ絞り込みできる
// (ユーザー指示: フォルダ方式からタグ方式へ変更。クリック/入力で該当するスペシャルだけを残す)。
import { useState, type KeyboardEvent } from "react";
import { Badge, Button, Flex, Text } from "@radix-ui/themes";
import { Star, X } from "lucide-react";
import { specialEntries } from "../../../lib/entities/special";
import { filterNotesByTags, tagCounts } from "../../../lib/search/tagSearch";
import { PanelCard } from "./PanelCard";
import type { Note, SpecialItem } from "../../../types";

type Props = {
  notes: Note[];
  specialItems: SpecialItem[];
  /** live項目(ボードに生きているノート)を開く。 */
  onSelectNote: (id: string) => void;
  /** スペシャルから外す(live=スター解除 / frozen=凍結項目を削除)。 */
  onRemove: (id: string, source: "live" | "frozen") => void;
};

export function SpecialPanel({ notes, specialItems, onSelectNote, onRemove }: Props) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const entries = specialEntries(notes, specialItems);
  // スペシャルに含まれるタグを出現回数降順で一覧する(ユーザー指示)。
  const chips = tagCounts(entries);
  const visible =
    selectedTags.length === 0 ? entries : filterNotesByTags(entries, selectedTags, "or");

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }

  function addTagFromInput(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const t = tagInput.trim();
    if (t === "") return;
    setSelectedTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagInput("");
  }

  return (
    <PanelCard
      data-testid="special-panel"
      title="スペシャル"
      icon={<Star size={15} aria-hidden="true" />}
    >
      <Flex direction="column" gap="2">
        {chips.length > 0 ? (
          <Flex gap="1" wrap="wrap" data-testid="special-tag-chips">
            {chips.map(({ tag, count }) => {
              const on = selectedTags.includes(tag);
              return (
                <Badge
                  key={tag}
                  asChild
                  color={on ? "blue" : "gray"}
                  variant={on ? "solid" : "soft"}
                >
                  <button
                    type="button"
                    data-testid="special-tag-chip"
                    data-tag={tag}
                    aria-pressed={on}
                    style={{ cursor: "pointer" }}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag} {count}
                  </button>
                </Badge>
              );
            })}
          </Flex>
        ) : null}
        <Flex gap="2" wrap="wrap" align="center">
          <input
            type="text"
            placeholder="タグで絞り込み(Enterで追加)"
            data-testid="special-tag-input"
            style={{ flex: 1, minWidth: 0 }}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={addTagFromInput}
          />
          {selectedTags.map((tag) => (
            <Badge key={tag} asChild color="blue" variant="solid">
              <button
                type="button"
                data-testid={`special-selected-tag-${tag}`}
                title="絞り込みから外す"
                style={{ cursor: "pointer" }}
                onClick={() => toggleTag(tag)}
              >
                {tag} <X size={11} aria-hidden="true" style={{ display: "inline" }} />
              </button>
            </Badge>
          ))}
        </Flex>

        {entries.length === 0 ? (
          <Text size="1" color="gray" data-testid="special-empty">
            ノートの見出し横のスターでスペシャルに保管できます
          </Text>
        ) : visible.length === 0 ? (
          <Text size="1" color="gray" data-testid="special-no-match">
            該当するスペシャルがありません
          </Text>
        ) : (
          <Flex direction="column" gap="1" asChild>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {visible.map((e) => (
                <li key={`${e.source}-${e.id}`} data-testid={`special-entry-${e.id}`}>
                  <Flex align="center" gap="1" wrap="wrap">
                    {e.source === "live" ? (
                      <Button
                        size="1"
                        variant="ghost"
                        data-testid={`special-open-${e.id}`}
                        title="このノートを開く"
                        onClick={() => onSelectNote(e.id)}
                      >
                        {e.title || "(無題)"}
                      </Button>
                    ) : (
                      <Text
                        size="1"
                        data-testid={`special-frozen-${e.id}`}
                        title="凍結済み(元ノートは削除)"
                      >
                        {e.title || "(無題)"} <Badge color="gray">凍結</Badge>
                      </Text>
                    )}
                    <Button
                      size="1"
                      variant="ghost"
                      color="red"
                      data-testid={`special-remove-${e.id}`}
                      title={e.source === "live" ? "スターを外す" : "凍結項目を削除"}
                      onClick={() => onRemove(e.id, e.source)}
                    >
                      <X size={14} aria-hidden="true" />
                    </Button>
                  </Flex>
                </li>
              ))}
            </ul>
          </Flex>
        )}
      </Flex>
    </PanelCard>
  );
}
