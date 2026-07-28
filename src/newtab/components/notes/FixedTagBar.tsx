// FixedTagBar.tsx — 固定タグモードの切替UI(ノート文字サイズと同じ行に置く・ユーザー指示)。
// プリセット(名前付きタグの組)をセレクトで選ぶと、盤面はそのタグを全て持つノートだけになり、
// 編集を終えたノートの本文末尾へ不足分の `#タグ` が入る(付与の実処理は NoteEditorPane)。
import { useState } from "react";
import { Badge, Button, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { Settings2, Tag, X } from "lucide-react";
import {
  addFixedTagPreset,
  parseFixedTagInput,
  removeFixedTagPreset,
} from "../../../lib/entities/fixedTagPresets";
import type { FixedTagPreset } from "../../../types";

type Props = {
  presets: FixedTagPreset[];
  activePresetId?: string;
  activeTags: string[];
  onPresetsChange: (presets: FixedTagPreset[]) => void;
  onActivePresetChange: (id: string) => void;
};

export function FixedTagBar({
  presets,
  activePresetId,
  activeTags,
  onPresetsChange,
  onActivePresetChange,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [tagsText, setTagsText] = useState("");

  function handleAdd() {
    const tags = parseFixedTagInput(tagsText);
    const next = addFixedTagPreset(presets, name, tags, crypto.randomUUID());
    if (next === presets) return; // 名前かタグが空。入力は消さず、そのまま直せるようにする
    onPresetsChange(next);
    setName("");
    setTagsText("");
  }

  function handleRemove(id: string) {
    onPresetsChange(removeFixedTagPreset(presets, id));
    // 消したプリセットが選択中なら、モードOFF(全件表示)へ戻す——選択idだけが残ると
    // 「どれも選ばれていないのに絞り込まれている」不能状態になる。
    if (id === activePresetId) onActivePresetChange("");
  }

  return (
    <>
      <Flex align="center" gap="2" data-testid="fixed-tag-bar">
        <Text size="1" color="gray">
          <Flex align="center" gap="1" as="span">
            <Tag size={13} aria-hidden="true" />
            固定タグ
          </Flex>
        </Text>
        <select
          className="fixed-tag-select"
          data-testid="fixed-tag-preset-select"
          aria-label="固定タグのプリセット"
          title="選ぶと、そのタグを全て持つノートだけを表示し、編集したノートへそのタグを付けます"
          value={activePresetId ?? ""}
          onChange={(e) => onActivePresetChange(e.target.value)}
        >
          <option value="">(なし)</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {activeTags.length > 0 ? (
          <Flex gap="1" wrap="wrap" data-testid="fixed-tag-active-tags">
            {activeTags.map((tag) => (
              <Badge key={tag} color="blue" variant="solid" data-testid={`fixed-tag-${tag}`}>
                #{tag}
              </Badge>
            ))}
          </Flex>
        ) : null}
        <IconButton
          type="button"
          size="1"
          variant="soft"
          color="gray"
          data-testid="fixed-tag-edit-toggle"
          aria-expanded={editing}
          title="固定タグのプリセットを登録・削除する"
          onClick={() => setEditing((v) => !v)}
        >
          <Settings2 size={14} aria-hidden="true" />
        </IconButton>
      </Flex>

      {editing ? (
        // 親(ノート文字サイズの行)は wrap する Flex なので、幅100%で必ず次の行へ落とす。
        <Flex align="center" gap="2" wrap="wrap" width="100%" data-testid="fixed-tag-editor">
          <TextField.Root
            size="1"
            data-testid="fixed-tag-name-input"
            placeholder="組の名前(例: 仕事)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField.Root
            size="1"
            data-testid="fixed-tag-tags-input"
            placeholder="タグ(空白区切り。例: 仕事 2026)"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
          />
          <Button type="button" size="1" data-testid="fixed-tag-add" onClick={handleAdd}>
            登録
          </Button>
          {presets.map((p) => (
            <Badge key={p.id} color="gray" variant="soft" data-testid={`fixed-tag-preset-${p.id}`}>
              {p.name}: {p.tags.map((t) => `#${t}`).join(" ")}
              <IconButton
                type="button"
                size="1"
                variant="ghost"
                color="gray"
                data-testid={`fixed-tag-preset-remove-${p.id}`}
                title={`「${p.name}」を削除する`}
                onClick={() => handleRemove(p.id)}
              >
                <X size={12} aria-hidden="true" />
              </IconButton>
            </Badge>
          ))}
        </Flex>
      ) : null}
    </>
  );
}
