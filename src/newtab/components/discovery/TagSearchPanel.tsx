// TagSearchPanel.tsx — NASの索引(index.db)から タグ(AND/OR)＋本文(部分一致)＋期間(半開区間)で
// ノートを検索し、結果一覧(10件/ページ)を表示。チェック/全件をノート末尾へ貼り付ける(ユーザー指示)。
// タグチップはNASの上位タグ(頻度順)。NAS未設定時はメモリ内タグへフォールバックする。
import { useEffect, useState } from "react";
import { Badge, Button, Card, Checkbox, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { ListChecks, RefreshCw, Search, Tag, X } from "lucide-react";
import { tagCounts } from "../../../lib/search/tagSearch";
import { getNasFolderPath } from "../../../lib/storage/db";
import {
  type NoteHit,
  type TagCount,
  rebuildNasIndex,
  searchNasNotes,
  topNasTags,
} from "../../../lib/externalIO/nasNativeHost";
import type { Note } from "../../../types";

type Props = {
  notes: Note[];
  onSelectNote: (noteId: string) => void;
  onPasteResults: (results: { title: string; content: string }[]) => void;
};

type Preset = "all" | "today" | "7d" | "30d" | "month" | "custom";
const PAGE_SIZE = 10;

/** プリセット期間を半開区間 [from, to) のISO文字列にする(NASのcreated_atはISO UTCで比較可能)。 */
function presetRange(preset: Preset): { from?: string; to?: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const iso = (d: Date) => d.toISOString();
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (preset === "today") return { from: iso(today), to: iso(tomorrow) };
  if (preset === "7d") {
    const f = new Date(today);
    f.setDate(today.getDate() - 6);
    return { from: iso(f), to: iso(tomorrow) };
  }
  if (preset === "30d") {
    const f = new Date(today);
    f.setDate(today.getDate() - 29);
    return { from: iso(f), to: iso(tomorrow) };
  }
  if (preset === "month") {
    return {
      from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
    };
  }
  return {}; // all
}

/** カスタム日付(YYYY-MM-DD)を半開区間へ。to は「その日を含む」ため翌日0時を上限にする。 */
function customRange(from: string, to: string): { from?: string; to?: string } {
  const r: { from?: string; to?: string } = {};
  if (from) r.from = new Date(`${from}T00:00:00`).toISOString();
  if (to) {
    const d = new Date(`${to}T00:00:00`);
    d.setDate(d.getDate() + 1);
    r.to = d.toISOString();
  }
  return r;
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: "all", label: "全期間" },
  { key: "today", label: "今日" },
  { key: "7d", label: "過去7日" },
  { key: "30d", label: "過去30日" },
  { key: "month", label: "今月" },
  { key: "custom", label: "カスタム" },
];

export function TagSearchPanel({ notes, onSelectNote, onPasteResults }: Props) {
  const [topTags, setTopTags] = useState<TagCount[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"and" | "or">("and");
  const [tagInput, setTagInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [preset, setPreset] = useState<Preset>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [results, setResults] = useState<NoteHit[] | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<"search" | "rebuild" | null>(null);
  const [msg, setMsg] = useState("");

  // 起動時にNASの上位タグを読み込む(NAS未設定/索引無しならnullのまま=メモリ内へフォールバック)。
  useEffect(() => {
    void loadTopTags();
  }, []);

  async function loadTopTags() {
    const path = await getNasFolderPath();
    if (!path) return;
    const tags = await topNasTags(path, 50);
    if (tags) setTopTags(tags);
  }

  // 表示するチップ: NAS上位タグ、無ければメモリ内タグ集計。
  const chips: TagCount[] = topTags ?? tagCounts(notes).map(({ tag, count }) => ({ tag, count }));

  function toggle(tag: string) {
    setSelected((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  function addTagFromInput() {
    const t = tagInput.trim();
    if (t === "") return;
    setSelected((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagInput("");
  }

  async function handleRebuild() {
    const path = await getNasFolderPath();
    if (!path) {
      setMsg("NASフォルダが未設定です(データ管理の「NASフォルダを設定」)");
      return;
    }
    setBusy("rebuild");
    setMsg("索引を更新中…");
    const counts = await rebuildNasIndex(path);
    await loadTopTags();
    setBusy(null);
    setMsg(
      counts
        ? `索引を更新しました(ノート${counts.notes}件・履歴${counts.snapshots}件)`
        : "索引の更新に失敗しました(NASブリッジ未導入か到達不可)",
    );
  }

  async function handleSearch() {
    const path = await getNasFolderPath();
    if (!path) {
      setMsg("NASフォルダが未設定です(データ管理の「NASフォルダを設定」)");
      return;
    }
    const range = preset === "custom" ? customRange(customFrom, customTo) : presetRange(preset);
    setBusy("search");
    setMsg("検索中…");
    const rows = await searchNasNotes(path, {
      tags: selected,
      text: keyword,
      mode,
      from: range.from,
      to: range.to,
    });
    setBusy(null);
    if (rows === null) {
      setResults(null);
      setMsg("検索できませんでした。先に「索引を更新」を実行してください");
      return;
    }
    setResults(rows);
    setCheckedIds(new Set());
    setPage(0);
    setMsg(`${rows.length}件ヒット`);
  }

  function toggleChecked(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pasteChecked() {
    if (!results) return;
    const rows = results.filter((r) => checkedIds.has(r.note_id));
    onPasteResults(rows.map((r) => ({ title: r.title ?? "", content: r.content })));
    setMsg(`チェックした${rows.length}件をノートへ貼り付けました`);
  }

  function pasteAll() {
    if (!results) return;
    onPasteResults(results.map((r) => ({ title: r.title ?? "", content: r.content })));
    setMsg(`${results.length}件をノートへ貼り付けました`);
  }

  const pageCount = results ? Math.ceil(results.length / PAGE_SIZE) : 0;
  const pageRows = results ? results.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : [];

  return (
    <Card data-testid="tag-search-panel">
      <Flex align="center" gap="3" wrap="wrap" mb="2">
        <Heading as="h2" size="3">
          <Flex align="center" gap="1" as="span">
            <Tag size={16} aria-hidden="true" />
            タグ・本文・期間でNASから検索
          </Flex>
        </Heading>
        <Button
          type="button"
          size="1"
          variant="soft"
          color="gray"
          data-testid="rebuild-index"
          title="NASの.mdからSQLite索引(index.db)を作り直し、上位タグも取り直す"
          disabled={busy !== null}
          onClick={() => void handleRebuild()}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {busy === "rebuild" ? "更新中…" : "索引を更新"}
        </Button>
        {selected.length >= 2 ? (
          <Button
            type="button"
            size="1"
            variant="soft"
            data-testid="tag-search-mode"
            onClick={() => setMode((m) => (m === "and" ? "or" : "and"))}
          >
            {mode === "and" ? "AND(全て含む)" : "OR(いずれか)"}
          </Button>
        ) : null}
      </Flex>

      {/* 上位タグ(頻度順)。クリックで選択。 */}
      <Flex gap="1" wrap="wrap" data-testid="tag-chips">
        {chips.map(({ tag, count }) => {
          const on = selected.includes(tag);
          return (
            <Badge key={tag} asChild color={on ? "blue" : "gray"} variant={on ? "solid" : "soft"}>
              <button
                type="button"
                data-testid="tag-chip"
                data-tag={tag}
                aria-pressed={on}
                style={{ cursor: "pointer" }}
                onClick={() => toggle(tag)}
              >
                {tag} {count}
              </button>
            </Badge>
          );
        })}
      </Flex>

      {/* 自由入力タグ + 選択中タグ。 */}
      <Flex gap="2" wrap="wrap" align="center" mt="2">
        <TextField.Root
          size="1"
          placeholder="タグを自由入力(Enterで追加)"
          data-testid="tag-input"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addTagFromInput();
          }}
        />
        {selected.map((tag) => (
          <Badge key={tag} asChild color="blue" variant="solid">
            <button
              type="button"
              data-testid={`selected-tag-${tag}`}
              title="外す"
              style={{ cursor: "pointer" }}
              onClick={() => toggle(tag)}
            >
              {tag} <X size={11} aria-hidden="true" style={{ display: "inline" }} />
            </button>
          </Badge>
        ))}
      </Flex>

      {/* 本文キーワード + 期間 + 検索。 */}
      <Flex gap="2" wrap="wrap" align="center" mt="2">
        <TextField.Root
          size="1"
          placeholder="本文キーワード(部分一致)"
          data-testid="keyword-input"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSearch();
          }}
        />
        <Button
          type="button"
          size="1"
          data-testid="search-notes-btn"
          disabled={busy !== null}
          onClick={() => void handleSearch()}
        >
          <Search size={14} aria-hidden="true" />
          {busy === "search" ? "検索中…" : "検索"}
        </Button>
      </Flex>

      <Flex gap="1" wrap="wrap" align="center" mt="2">
        <Text size="1" color="gray">
          期間:
        </Text>
        {PRESETS.map(({ key, label }) => (
          <Button
            key={key}
            type="button"
            size="1"
            variant={preset === key ? "solid" : "soft"}
            color="gray"
            data-testid={`range-preset-${key}`}
            onClick={() => setPreset(key)}
          >
            {label}
          </Button>
        ))}
        {preset === "custom" ? (
          <>
            <input
              type="date"
              data-testid="range-from"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <Text size="1" color="gray">
              〜
            </Text>
            <input
              type="date"
              data-testid="range-to"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </>
        ) : null}
      </Flex>

      {msg ? (
        <Text size="1" color="gray" mt="2" data-testid="tag-search-message">
          {msg}
        </Text>
      ) : null}

      {/* 結果一覧(10件/ページ)+ 貼り付け。 */}
      {results && results.length > 0 ? (
        <>
          <Flex gap="2" mt="2" wrap="wrap">
            <Button
              type="button"
              size="1"
              variant="soft"
              data-testid="paste-checked"
              disabled={checkedIds.size === 0}
              onClick={pasteChecked}
            >
              <ListChecks size={14} aria-hidden="true" />
              チェックを貼り付け({checkedIds.size})
            </Button>
            <Button
              type="button"
              size="1"
              variant="soft"
              data-testid="paste-all"
              onClick={pasteAll}
            >
              全て貼り付け({results.length})
            </Button>
          </Flex>
          <ul className="search-results" data-testid="notes-search-results">
            {pageRows.map((hit) => (
              <li key={hit.note_id} data-testid={`notes-search-item-${hit.note_id}`}>
                <Flex align="center" gap="2">
                  <Checkbox
                    data-testid={`result-check-${hit.note_id}`}
                    checked={checkedIds.has(hit.note_id)}
                    onCheckedChange={() => toggleChecked(hit.note_id)}
                  />
                  <button
                    type="button"
                    className="search-result-btn"
                    data-testid={`notes-search-open-${hit.note_id}`}
                    onClick={() => onSelectNote(hit.note_id)}
                  >
                    <span className="search-result-title">
                      {hit.title ?? "(無題)"}
                      {hit.created_at ? ` — ${new Date(hit.created_at).toLocaleDateString()}` : ""}
                    </span>
                    <span className="search-result-snippet">{hit.snippet}</span>
                  </button>
                </Flex>
              </li>
            ))}
          </ul>
          {pageCount > 1 ? (
            <Flex gap="1" wrap="wrap" mt="2" data-testid="page-selector">
              {Array.from({ length: pageCount }, (_, i) => (
                <Button
                  key={i}
                  type="button"
                  size="1"
                  variant={i === page ? "solid" : "soft"}
                  color="gray"
                  data-testid={`page-${i + 1}`}
                  onClick={() => setPage(i)}
                >
                  {i + 1}
                </Button>
              ))}
            </Flex>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
