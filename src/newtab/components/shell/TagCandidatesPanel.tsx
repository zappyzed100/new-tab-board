// TagCandidatesPanel.tsx — タグ候補(ユーザーが手で並べる語彙)の管理UI。TODOリストの下に置く。
// 単純に候補を並べるだけ。LLMのタグ推定時に「優先的に選ぶ候補」として参照される(ユーザー指示)。
import { useState, type KeyboardEvent } from "react";
import { Badge, Card, Flex, Heading, IconButton, Text, TextField } from "@radix-ui/themes";
import { addTagCandidate, removeTagCandidate } from "../../../lib/entities/tagCandidates";

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
    <Card data-testid="tag-candidates-panel">
      <Heading as="h2" size="4" mb="1">
        タグ候補
      </Heading>
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
          <Badge key={tag} color="indigo" variant="soft" data-testid={`tag-candidate-${tag}`}>
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
              ×
            </IconButton>
          </Badge>
        ))}
      </Flex>
    </Card>
  );
}
