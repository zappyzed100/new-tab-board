// SearchPanel.tsx — 全ノート横断の全文検索UI(現在の本文を部分一致で走査。SPEC.md §4.3)
// スナップショット索引(search.ts)ではなく生の本文をその場で検索する——日本語の部分文字列でも
// 引け、まだ履歴に刻まれていない書きかけの本文も対象になる(ユーザー指摘「全文検索が空」への対応)。
// 常時表示(検索ON/OFFトグルは撤去済み)のため、Cmd/Ctrl+Fはこの検索欄へフォーカスを移す。
import { forwardRef, useMemo, useState } from "react";
import { Card, Heading, Text, TextField } from "@radix-ui/themes";
import { searchNotesByText } from "../../../lib/search/noteSearch";
import type { Note } from "../../../types";

type Props = {
  notes: Note[];
  onSelectNote: (noteId: string) => void;
};

export const SearchPanel = forwardRef<HTMLInputElement, Props>(function SearchPanel(
  { notes, onSelectNote },
  ref,
) {
  const [query, setQuery] = useState("");
  // notesもqueryも変わるたびに引き直す(常に最新の本文が対象・書いた直後でも見つかる)。
  const results = useMemo(() => searchNotesByText(notes, query), [notes, query]);

  return (
    <Card data-testid="search-panel">
      <Heading as="h2" size="3" mb="3">
        🔍 全文検索(全ノートの本文を横断・部分一致)
      </Heading>
      <TextField.Root
        ref={ref}
        aria-label="全文検索"
        data-testid="search-input"
        placeholder="検索したい語を入力(本文の一部でも可)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() !== "" ? (
        <Text as="p" size="1" color="gray" data-testid="search-result-count" mt="2">
          {results.length}件ヒット
        </Text>
      ) : null}
      {/* Radix Buttonは単一行前提で高さが固定のため、2行(タイトル+スニペット)を入れると
          はみ出して結果同士が重なる(ユーザー指摘)。自前の可変高ボタンで縦に積む。 */}
      <ul className="search-results">
        {results.map((item) => (
          <li key={item.note.id} data-testid={`search-result-${item.note.id}`}>
            <button
              type="button"
              className="search-result-btn"
              data-testid={`search-result-open-${item.note.id}`}
              onClick={() => onSelectNote(item.note.id)}
            >
              <span className="search-result-title">{item.note.title}</span>
              <span className="search-result-snippet">{item.snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
});
