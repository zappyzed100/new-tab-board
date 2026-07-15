// SearchPanel.tsx — 全ノート横断の全文検索UI(現在の本文を部分一致で走査。SPEC.md §4.3)
// スナップショット索引(search.ts)ではなく生の本文をその場で検索する——日本語の部分文字列でも
// 引け、まだ履歴に刻まれていない書きかけの本文も対象になる(ユーザー指摘「全文検索が空」への対応)。
// 常時表示(検索ON/OFFトグルは撤去済み)のため、Cmd/Ctrl+Fはこの検索欄へフォーカスを移す。
// Cmd/Ctrl+Rは既存の全文検索を拡張した置換欄を開く(ユーザー指示)——対象ノートを
// チェックボックスで選んで、選んだノートだけに一括置換を適用できる。
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Checkbox, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { Replace, Search } from "lucide-react";
import { searchNotesByText } from "../../../lib/search/noteSearch";
import type { Note } from "../../../types";

type Props = {
  notes: Note[];
  onSelectNote: (noteId: string) => void;
  /** 増えるたびに置換欄を開いてフォーカスする共有カウンタ(Cmd/Ctrl+R用・manualSyncSignalと同じ発想)。 */
  replaceSignal: number;
  /** targetIdsのノートだけを対象にqueryの全出現をreplacementへ置換する。実際に変更した件数を返す。 */
  onReplace: (query: string, replacement: string, targetIds: Set<string>) => number;
};

export const SearchPanel = forwardRef<HTMLInputElement, Props>(function SearchPanel(
  { notes, onSelectNote, replaceSignal, onReplace },
  ref,
) {
  const [query, setQuery] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [replacement, setReplacement] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // notesもqueryも変わるたびに引き直す(常に最新の本文が対象・書いた直後でも見つかる)。
  const results = useMemo(() => searchNotesByText(notes, query), [notes, query]);
  const resultIdsKey = results.map((r) => r.note.id).join(",");

  // ヒットの顔ぶれ(id集合)が変わるたび、対象選択は「ヒット全件」へリセットする(置換は
  // 既定で全ヒットに適用し、外したいものだけチェックを外す運用——ユーザー指示)。
  // resultsの参照ではなくid集合をキーにするのは、置換実行で他ノートの内容が変わって
  // useMemoが新しい配列を返しても、ヒットの顔ぶれ自体が同じなら選択を保つため
  // (resultsをキーにすると、置換直後にresultMessageまで巻き添えでリセットされていた)。
  useEffect(() => {
    setSelectedIds(new Set(results.map((r) => r.note.id)));
  }, [resultIdsKey]);

  // クエリを打ち直したら前回の置換結果メッセージは消す(新しい検索の開始)。
  useEffect(() => {
    setResultMessage(null);
  }, [query]);

  useEffect(() => {
    if (replaceSignal === 0) return;
    setShowReplace(true);
  }, [replaceSignal]);

  // showReplaceがtrueになった直後はまだ置換欄がDOMに無い(同一レンダー内でrefは取れない)ため、
  // 実際にマウントされた後のこのeffectでフォーカスする。手動トグル(置換ボタンクリック)でも同様に効く。
  useEffect(() => {
    if (showReplace) replaceInputRef.current?.focus();
  }, [showReplace]);

  function toggleTarget(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllTargets() {
    setSelectedIds((prev) =>
      prev.size === results.length ? new Set() : new Set(results.map((r) => r.note.id)),
    );
  }

  function runReplace() {
    const count = onReplace(query, replacement, selectedIds);
    setResultMessage(count > 0 ? `${count}件のノートを置換しました` : "置換対象がありません");
  }

  return (
    <Card data-testid="search-panel">
      <Heading as="h2" size="3" mb="3">
        <Flex align="center" gap="1" as="span">
          <Search size={16} aria-hidden="true" />
          全文検索(全ノートの本文を横断・部分一致)
        </Flex>
      </Heading>
      <Flex gap="2" align="center">
        <TextField.Root
          ref={ref}
          aria-label="全文検索"
          data-testid="search-input"
          placeholder="検索したい語を入力(本文の一部でも可)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          type="button"
          size="1"
          variant={showReplace ? "solid" : "soft"}
          data-testid="replace-toggle"
          title="置換欄を開閉(Cmd/Ctrl+R)"
          onClick={() => setShowReplace((v) => !v)}
        >
          <Replace size={14} aria-hidden="true" />
          置換
        </Button>
      </Flex>
      {query.trim() !== "" ? (
        <Text as="p" size="1" color="gray" data-testid="search-result-count" mt="2">
          {results.length}件ヒット
        </Text>
      ) : null}
      {showReplace ? (
        <Flex direction="column" gap="2" mt="2" data-testid="replace-section">
          <TextField.Root
            ref={replaceInputRef}
            aria-label="置換後の文字列"
            data-testid="replace-input"
            placeholder="置換後の文字列"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
          />
          <Flex align="center" gap="2" wrap="wrap">
            <Button
              type="button"
              size="1"
              variant="soft"
              data-testid="replace-select-all"
              onClick={toggleAllTargets}
              disabled={results.length === 0}
            >
              {selectedIds.size === results.length && results.length > 0
                ? "すべて解除"
                : "すべて選択"}
            </Button>
            <Button
              type="button"
              size="1"
              data-testid="replace-apply"
              disabled={query.trim() === "" || selectedIds.size === 0}
              onClick={runReplace}
            >
              選択した{selectedIds.size}件を置換
            </Button>
          </Flex>
          {resultMessage ? (
            <Text as="p" size="1" color="gray" data-testid="replace-result-message">
              {resultMessage}
            </Text>
          ) : null}
        </Flex>
      ) : null}
      {/* Radix Buttonは単一行前提で高さが固定のため、2行(タイトル+スニペット)を入れると
          はみ出して結果同士が重なる(ユーザー指摘)。自前の可変高ボタンで縦に積む。 */}
      <ul className="search-results">
        {results.map((item) => (
          <li key={item.note.id} data-testid={`search-result-${item.note.id}`}>
            <Flex align="center" gap="1">
              {showReplace ? (
                <Checkbox
                  data-testid={`replace-target-${item.note.id}`}
                  checked={selectedIds.has(item.note.id)}
                  onCheckedChange={() => toggleTarget(item.note.id)}
                  aria-label={`${item.note.title}を置換対象にする`}
                />
              ) : null}
              <button
                type="button"
                className="search-result-btn"
                data-testid={`search-result-open-${item.note.id}`}
                onClick={() => onSelectNote(item.note.id)}
              >
                <span className="search-result-title">{item.note.title}</span>
                <span className="search-result-snippet">{item.snippet}</span>
              </button>
            </Flex>
          </li>
        ))}
      </ul>
    </Card>
  );
});
