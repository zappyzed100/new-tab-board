// SpecialPanel.tsx — ⭐スペシャル(保管棚)のサイドバーカード。スター済みノート(live)と
// 削除で凍結した項目(frozen)を一覧し、フォルダ作成・フォルダ移動・開く・外すを行う(ユーザー指示)。
import { useState } from "react";
import { Badge, Button, Flex, Text, TextField } from "@radix-ui/themes";
import { Plus, Star, X } from "lucide-react";
import { specialEntries } from "../../../lib/entities/special";
import { PanelCard } from "./PanelCard";
import type { Note, SpecialItem } from "../../../types";

type Props = {
  notes: Note[];
  specialItems: SpecialItem[];
  folders: string[];
  /** live項目(ボードに生きているノート)を開く。 */
  onSelectNote: (id: string) => void;
  /** フォルダ移動(空文字=ルート)。 */
  onMoveToFolder: (id: string, source: "live" | "frozen", folder: string) => void;
  /** スペシャルから外す(live=スター解除 / frozen=凍結項目を削除)。 */
  onRemove: (id: string, source: "live" | "frozen") => void;
  onCreateFolder: (path: string) => void;
};

export function SpecialPanel({
  notes,
  specialItems,
  folders,
  onSelectNote,
  onMoveToFolder,
  onRemove,
  onCreateFolder,
}: Props) {
  const [newFolder, setNewFolder] = useState("");
  const entries = specialEntries(notes, specialItems);

  return (
    <PanelCard
      data-testid="special-panel"
      title="スペシャル"
      icon={<Star size={15} aria-hidden="true" />}
    >
      <Flex direction="column" gap="2">
        {/* フォルダ作成 */}
        <Flex gap="1" align="center">
          <TextField.Root
            size="1"
            style={{ flex: 1 }}
            placeholder="新規フォルダ(例: 仕事/2026)"
            data-testid="special-new-folder"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolder.trim()) {
                onCreateFolder(newFolder);
                setNewFolder("");
              }
            }}
          />
          <Button
            size="1"
            variant="soft"
            data-testid="special-create-folder"
            onClick={() => {
              if (newFolder.trim()) {
                onCreateFolder(newFolder);
                setNewFolder("");
              }
            }}
          >
            <Plus size={14} aria-hidden="true" />
          </Button>
        </Flex>

        {entries.length === 0 ? (
          <Text size="1" color="gray" data-testid="special-empty">
            ノートの見出し横のスターでスペシャルに保管できます
          </Text>
        ) : (
          <Flex direction="column" gap="1" asChild>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {entries.map((e) => (
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
                    {/* フォルダ移動(ネイティブselect: ルート + 既存フォルダ) */}
                    <select
                      data-testid={`special-folder-select-${e.id}`}
                      value={e.folder ?? ""}
                      onChange={(ev) => onMoveToFolder(e.id, e.source, ev.target.value)}
                    >
                      <option value="">(ルート)</option>
                      {folders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
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
