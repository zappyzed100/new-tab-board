// SearchPanel.tsx — 全ノート横断の全文検索UI(ヒット箇所プレビュー+日時一覧。SPEC.md §4.3)
import { useState } from "react";
import { getSnapshot } from "../../lib/db";
import { gzipDecompress } from "../../lib/gzip";
import { searchSnapshotIds } from "../../lib/search";
import type { Note, Snapshot } from "../../types";

type ResultItem = { snapshot: Snapshot; preview: string; noteTitle: string };

type Props = {
  notes: Note[];
  onSelectNote: (noteId: string) => void;
};

export function SearchPanel({ notes, onSelectNote }: Props) {
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
      const text = await gzipDecompress(snapshot.content);
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
    <div data-testid="search-panel">
      <input
        aria-label="全文検索"
        data-testid="search-input"
        value={query}
        onChange={(e) => void runSearch(e.target.value)}
      />
      <ul>
        {results.map((item) => (
          <li key={item.snapshot.id} data-testid={`search-result-${item.snapshot.id}`}>
            <button
              type="button"
              data-testid={`search-result-open-${item.snapshot.id}`}
              onClick={() => onSelectNote(item.snapshot.noteId)}
            >
              {item.noteTitle} — {new Date(item.snapshot.timestamp).toLocaleString()}:{" "}
              {item.preview}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
