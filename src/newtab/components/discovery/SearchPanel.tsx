// SearchPanel.tsx — 全ノート横断の全文検索UI(ヒット箇所プレビュー+日時一覧。SPEC.md §4.3)
// 常時表示(検索ON/OFFトグルは撤去済み)のため、Cmd/Ctrl+Fは「開く/閉じる」ではなく
// この検索欄へフォーカスを移す操作として再割り当てされている(App.tsxのuseGlobalShortcuts参照)。
import { forwardRef, useState } from "react";
import { Button, Card, Flex, Heading, TextField } from "@radix-ui/themes";
import { getSnapshot } from "../../../lib/storage/db";
import { gzipDecompress } from "../../../lib/history/gzip";
import { getSnapshotBody } from "../../../lib/externalIO/nasArchive";
import { searchSnapshotIds } from "../../../lib/search/search";
import type { Note, Snapshot } from "../../../types";

type ResultItem = { snapshot: Snapshot; preview: string; noteTitle: string };

type Props = {
  notes: Note[];
  onSelectNote: (noteId: string) => void;
};

export const SearchPanel = forwardRef<HTMLInputElement, Props>(function SearchPanel(
  { notes, onSelectNote },
  ref,
) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResultItem[]>([]);

  async function runSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const ids = await searchSnapshotIds(q);
    const items: ResultItem[] = [];
    for (const id of ids) {
      const snapshot = await getSnapshot(id);
      if (!snapshot) continue;
      const body = await getSnapshotBody(snapshot);
      if (body === null) continue; // NAS排出済みでオフライン等(degrade——検索結果からは除く)
      const text = await gzipDecompress(body);
      const note = notes.find((n) => n.id === snapshot.noteId);
      items.push({
        snapshot,
        preview: text.slice(0, 80),
        noteTitle: note?.title ?? "(不明なノート)",
      });
    }
    items.sort((a, b) => b.snapshot.timestamp - a.snapshot.timestamp);
    setResults(items);
  }

  return (
    <Card data-testid="search-panel">
      <Heading as="h2" size="3" mb="3">
        🔍 全文検索(全ノートの本文を横断)
      </Heading>
      <TextField.Root
        ref={ref}
        aria-label="全文検索"
        data-testid="search-input"
        placeholder="検索したい単語を入力(完全一致)"
        value={query}
        onChange={(e) => void runSearch(e.target.value)}
      />
      <ul>
        {results.map((item) => (
          <li key={item.snapshot.id} data-testid={`search-result-${item.snapshot.id}`}>
            <Button
              type="button"
              variant="soft"
              data-testid={`search-result-open-${item.snapshot.id}`}
              onClick={() => onSelectNote(item.snapshot.noteId)}
            >
              <Flex as="span" direction="column" align="start">
                {item.noteTitle} — {new Date(item.snapshot.timestamp).toLocaleString()}:{" "}
                {item.preview}
              </Flex>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
});
