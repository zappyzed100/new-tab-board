// TagCandidatesPanel.tsx — タグ候補(ユーザーが手で並べる語彙)の管理UI。TODOリストの下に置く。
// 単純に候補を並べるだけ。LLMのタグ推定時に「優先的に選ぶ候補」として参照される(ユーザー指示)。
import { useState, type KeyboardEvent } from "react";
import { Badge, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { Tags, X } from "lucide-react";
import { addTagCandidate, removeTagCandidate } from "../../../lib/entities/tagCandidates";
import { PanelCard } from "./PanelCard";

type Props = {
  candidates: string[];
  onCandidatesChange: (candidates: string[]) => void;
};

export function TagCandidatesPanel({ candidates, onCandidatesChange }: Props) {
  const [text, setText] = useState("");

  function handleAdd(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    onCandidatesChange(addTagCandidate(candidates, text));
    setText("");
  }

  return (
    <PanelCard
      data-testid="tag-candidates-panel"
      title="タグ候補"
      icon={<Tags size={15} aria-hidden="true" />}
    >
      <Text as="p" size="1" color="gray" mb="2">
        AIがタグを付けるとき、ここの候補から優先的に選びます
      </Text>
      <TextField.Root
        type="text"
        data-testid="tag-candidate-input"
        placeholder="候補を追加(例: LLMへの指示) — Enterで追加"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleAdd}
      />
      <Flex gap="1" wrap="wrap" mt="2" data-testid="tag-candidate-list">
        {candidates.map((tag) => (
          <Badge key={tag} color="blue" variant="soft" data-testid={`tag-candidate-${tag}`}>
            {tag}
            <IconButton
              type="button"
              size="1"
              variant="ghost"
              color="gray"
              data-testid={`tag-candidate-remove-${tag}`}
              title={`「${tag}」を候補から外す`}
              onClick={() => onCandidatesChange(removeTagCandidate(candidates, tag))}
            >
              <X size={12} aria-hidden="true" />
            </IconButton>
          </Badge>
        ))}
      </Flex>
    </PanelCard>
  );
}
