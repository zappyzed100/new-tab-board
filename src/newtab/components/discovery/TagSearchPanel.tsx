// TagSearchPanel.tsx — タグでノートを絞り込むパネル(メモリ内・索引不要。tagSearch.tsの純粋ロジックを使う)
import { useState } from "react";
import { Badge, Button, Card, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { filterNotesByTags, relatedTags, tagCounts } from "../../../lib/search/tagSearch";
import { getNasFolderPath } from "../../../lib/storage/db";
import {
  type HistoryHit,
  rebuildNasIndex,
  searchNasHistory,
} from "../../../lib/externalIO/nasNativeHost";
import type { Note } from "../../../types";

type Props = {
  notes: Note[];
  onSelectNote: (noteId: string) => void;
};

export function TagSearchPanel({ notes, onSelectNote }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"and" | "or">("and");
  // 履歴(NAS)のSQL検索用の状態。現在ノートはメモリ内、履歴はhost経由でSQL(タグ→本文LIKE)。
  const [historyText, setHistoryText] = useState("");
  const [hits, setHits] = useState<HistoryHit[] | null>(null);
  const [busy, setBusy] = useState<"search" | "rebuild" | null>(null);
  const [historyMsg, setHistoryMsg] = useState("");

  const counts = tagCounts(notes);
  if (counts.length === 0) return null; // タグがまだ無ければ何も出さない

  const matching = filterNotesByTags(notes, selected, mode);
  const related = relatedTags(notes, selected);

  function toggle(tag: string) {
    setSelected((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  async function handleRebuildIndex() {
    const path = await getNasFolderPath();
    if (!path) {
      setHistoryMsg("NASフォルダが未設定です(データ管理の「NASフォルダを設定」)");
      return;
    }
    setBusy("rebuild");
    setHistoryMsg("索引を更新中…");
    const counts2 = await rebuildNasIndex(path);
    setBusy(null);
    setHistoryMsg(
      counts2
        ? `索引を更新しました(ノート${counts2.notes}件・履歴${counts2.snapshots}件)`
        : "索引の更新に失敗しました(NASブリッジ未導入か到達不可)",
    );
  }

  async function handleSearchHistory() {
    const path = await getNasFolderPath();
    if (!path) {
      setHistoryMsg("NASフォルダが未設定です(データ管理の「NASフォルダを設定」)");
      return;
    }
    setBusy("search");
    setHistoryMsg("履歴を検索中…");
    const rows = await searchNasHistory(path, { tags: selected, text: historyText, mode });
    setBusy(null);
    if (rows === null) {
      setHits(null);
      setHistoryMsg("検索できませんでした。先に「🔄 索引を更新」を実行してください");
      return;
    }
    setHits(rows);
    setHistoryMsg(`履歴 ${rows.length}件ヒット`);
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

      {/* 過去の履歴(NAS)をSQL検索する。現在ノートはメモリ内(上)、履歴はhost経由のSQL(タグ→本文LIKE)。
          ブラウザからSQLiteは叩けないため、Python(nas_bridge.py)がindex.dbを検索して結果だけ返す。 */}
      <Flex
        direction="column"
        gap="2"
        mt="3"
        pt="2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <Text size="1" color="gray">
          過去の履歴も検索(NAS)。上で選んだタグ＋下のキーワードで絞り込みます。
        </Text>
        <Flex gap="2" wrap="wrap" align="center">
          <TextField.Root
            size="1"
            placeholder="本文キーワード(部分一致)"
            data-testid="history-search-input"
            value={historyText}
            onChange={(e) => setHistoryText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSearchHistory();
            }}
          />
          <Button
            type="button"
            size="1"
            variant="soft"
            data-testid="search-history"
            disabled={busy !== null}
            onClick={() => void handleSearchHistory()}
          >
            {busy === "search" ? "検索中…" : "🔍 履歴を検索"}
          </Button>
          <Button
            type="button"
            size="1"
            variant="soft"
            color="gray"
            data-testid="rebuild-index"
            title="NASの.mdと履歴からSQLite索引(index.db)を作り直す"
            disabled={busy !== null}
            onClick={() => void handleRebuildIndex()}
          >
            {busy === "rebuild" ? "更新中…" : "🔄 索引を更新"}
          </Button>
        </Flex>
        {historyMsg ? (
          <Text size="1" color="gray" data-testid="history-search-message">
            {historyMsg}
          </Text>
        ) : null}
        {hits && hits.length > 0 ? (
          <Flex direction="column" gap="1" asChild>
            <ul data-testid="history-results">
              {hits.map((hit) => (
                <li key={`${hit.note_id}-${hit.timestamp}`}>
                  <Button
                    type="button"
                    variant="ghost"
                    data-testid={`history-result-${hit.note_id}`}
                    title={hit.snippet}
                    onClick={() => onSelectNote(hit.note_id)}
                  >
                    {hit.title ?? "(削除済みノート)"} — {new Date(hit.timestamp).toLocaleString()}
                  </Button>
                </li>
              ))}
            </ul>
          </Flex>
        ) : null}
      </Flex>
    </Card>
  );
}
