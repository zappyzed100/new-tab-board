// NoteEditorPane.tsx — ノート編集エリア1件分(SPEC.md §4.2)
// 複数ノートを横並び表示する際、1ペイン=1コンポーネントインスタンスとして完全に独立させる
// (プレビュー/履歴表示・Drive同期状態はペインごとに別々でよい概念のため)。全文検索だけは
// 「全ノート横断」という性質上グローバル据え置き(App.tsx側のまま)。
import { lazy, Suspense, useEffect, useState } from "react";
import { Badge, Button, Card, Flex, Text } from "@radix-ui/themes";
import { BacklinksPanel } from "./BacklinksPanel";
import { SnapshotScheduler } from "./SnapshotScheduler";
import { updateNote } from "../../../lib/entities/notes";
import { now as clockNow } from "../../../lib/runtime/clock";
import { useDriveSync } from "../../../lib/drive/useDriveSync";
import { forceSnapshot } from "../../../lib/history/useSnapshotScheduler";
import { getGeminiApiKey } from "../../../lib/storage/db";
import { extractTodos, summarizeNote } from "../../../lib/gemini/noteAi";
import { analyzeNote, contentHash, needsRetag } from "../../../lib/gemini/tagging";
import type { Note } from "../../../types";

const GEMINI_KEY_HINT = "Gemini APIキーを設定してください(データ管理の🔑ボタン)";

const DRIVE_SYNC_LABEL: Record<string, string> = {
  idle: "",
  syncing: "同期中…",
  synced: "☁同期済",
  unauthenticated: "Drive未認証",
  error: "同期エラー",
};

// CodeMirror本体はサイズが大きいため動的importで分割し、初期描画をブロックしない
// (SPEC.md §8「新規タブは即座に描画」)。複数ペインで使い回してもモジュール自体は
// 1回しか読み込まれない(React.lazyはモジュールスコープの単一参照)。
const Notepad = lazy(() => import("./Notepad").then((m) => ({ default: m.Notepad })));
const MarkdownPreview = lazy(() =>
  import("./MarkdownPreview").then((m) => ({ default: m.MarkdownPreview })),
);
const HistoryPanel = lazy(() =>
  import("./HistoryPanel").then((m) => ({ default: m.HistoryPanel })),
);

type Props = {
  note: Note;
  notes: Note[];
  isActive: boolean;
  autoFocus: boolean;
  /** Cmd/Ctrl+Sが押されるたびに増える共有カウンタ。表示中の全ペインがこれを監視し、
   * 自分のノートを即時スナップショット+Drive同期する(「見えている全部を保存する」)。 */
  manualSyncSignal: number;
  onNotesChange: (update: Note[] | ((prev: Note[]) => Note[])) => void;
  onSelectNote: (noteId: string) => void;
  onSelectNoteByTitle: (title: string) => void;
  /** 要約結果を新規ノートとして作成する(App.tsx: createNote+addNote+選択)。 */
  onCreateNote: (
    title: string,
    content: string,
    meta?: { sourceNoteId?: string; generatedBy?: string },
  ) => void;
  /** 抽出したTODOをTODOリストへ追加する。 */
  onAddTodos: (texts: string[]) => void;
  /** データ管理パネルの結果メッセージ欄へ通知する。 */
  onMessage: (message: string) => void;
};

export function NoteEditorPane({
  note,
  notes,
  isActive,
  autoFocus,
  manualSyncSignal,
  onNotesChange,
  onSelectNote,
  onSelectNoteByTitle,
  onCreateNote,
  onAddTodos,
  onMessage,
}: Props) {
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [restoreCounter, setRestoreCounter] = useState(0);
  // Gemini処理中の状態("summary"|"todo"|"tag"|null)。二重押しを防ぎラベルを切り替える。
  const [aiBusy, setAiBusy] = useState<"summary" | "todo" | "tag" | null>(null);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(note.content);
      onMessage(`「${note.title}」の本文をクリップボードにコピーしました`);
    } catch (err) {
      onMessage(`コピーに失敗しました(${err instanceof Error ? err.message : String(err)})`);
    }
  }

  async function handleTagThisNote() {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      onMessage(GEMINI_KEY_HINT);
      return;
    }
    if (note.content.trim() === "") {
      onMessage("本文が空のためタグを付けられません");
      return;
    }
    setAiBusy("tag");
    onMessage(`「${note.title}」にGeminiでタグ付け中…`);
    const { tags, junk } = await analyzeNote(note.content, apiKey);
    setAiBusy(null);
    if (tags.length === 0 && !junk) {
      onMessage("タグを付けられませんでした(Gemini呼び出しに失敗した可能性)");
      return;
    }
    onNotesChange((prev) =>
      updateNote(prev, note.id, { tags, junk, taggedHash: contentHash(note.content) }),
    );
    onMessage(
      `「${note.title}」に${tags.length}件のタグを付けました${junk ? "(ゴミ判定: NAS保管対象外)" : ""}`,
    );
  }

  // 保存(スナップショット)時の自動タグ付け(ユーザー指示)。キー未設定・空・前回から変更なしは
  // 静かに何もしない(自動なのでエラーは出さない)。junk判定はNASアーカイブ除外に使われる。
  async function autoTagOnSnapshot(savedContent: string) {
    if (savedContent.trim() === "") return;
    if (!needsRetag({ content: savedContent, taggedHash: note.taggedHash })) return;
    const apiKey = await getGeminiApiKey();
    if (!apiKey) return;
    const { tags, junk } = await analyzeNote(savedContent, apiKey);
    if (tags.length === 0 && !junk) return;
    onNotesChange((prev) =>
      updateNote(prev, note.id, { tags, junk, taggedHash: contentHash(savedContent) }),
    );
  }

  async function handleSummarize() {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      onMessage(GEMINI_KEY_HINT);
      return;
    }
    setAiBusy("summary");
    onMessage(`「${note.title}」をGeminiで要約中…`);
    const summary = await summarizeNote(note.content, apiKey);
    setAiBusy(null);
    if (!summary) {
      onMessage("要約に失敗しました(本文が空か、Gemini呼び出しに失敗しました)");
      return;
    }
    onCreateNote(`${note.title}の要約`, summary, {
      sourceNoteId: note.id,
      generatedBy: "gemini",
    });
    onMessage(`「${note.title}の要約」を作成しました`);
  }

  async function handleExtractTodos() {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      onMessage(GEMINI_KEY_HINT);
      return;
    }
    setAiBusy("todo");
    onMessage(`「${note.title}」からGeminiでTODOを抽出中…`);
    const todos = await extractTodos(note.content, apiKey);
    setAiBusy(null);
    if (todos.length === 0) {
      onMessage("TODOは見つかりませんでした(本文が空か、抽出できませんでした)");
      return;
    }
    onAddTodos(todos);
    onMessage(`TODOを${todos.length}件、TODOリストへ追加しました`);
  }

  const { status: driveSyncStatus, syncNow: syncDriveNow } = useDriveSync(
    note,
    (driveFileId, lastSyncedAt) => {
      onNotesChange((prev) => updateNote(prev, note.id, { driveFileId, lastSyncedAt }));
    },
  );

  useEffect(() => {
    if (manualSyncSignal === 0) return;
    void forceSnapshot(note.id, note.content);
    syncDriveNow(true);
    // manualSyncSignalの変化だけで発火させる意図的な依存配列(note.contentは
    // syncDriveNow内部でnoteRef経由の最新値を読むため依存に含める必要はない)。
  }, [manualSyncSignal]);

  return (
    <Card data-testid={`note-editor-area-${note.id}`} data-active={isActive || undefined}>
      <Flex direction="column" gap="3">
        <SnapshotScheduler noteId={note.id} content={note.content} onSnapshot={autoTagOnSnapshot} />
        <Flex align="center" gap="3" wrap="wrap">
          <Button
            type="button"
            variant={showPreview ? "solid" : "soft"}
            data-testid={`toggle-preview-${note.id}`}
            title="Markdown記法(見出し・リスト等)を清書して表示する"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? "編集に戻る" : "Markdownプレビュー"}
          </Button>
          <Button
            type="button"
            variant={showHistory ? "solid" : "soft"}
            data-testid={`toggle-history-${note.id}`}
            title="過去のスナップショット一覧・差分表示・復元"
            onClick={() => setShowHistory((v) => !v)}
          >
            🕑 {showHistory ? "履歴を閉じる" : "履歴"}
          </Button>
          <Button
            type="button"
            variant="soft"
            data-testid={`summarize-${note.id}`}
            title="Geminiでこのノートを要約し、「〇〇の要約」ノートを新規作成する"
            disabled={aiBusy !== null}
            onClick={() => void handleSummarize()}
          >
            {aiBusy === "summary" ? "要約中…" : "✨ 要約"}
          </Button>
          <Button
            type="button"
            variant="soft"
            data-testid={`extract-todos-${note.id}`}
            title="Geminiでこのノートからやるべきこと(TODO)を抽出し、TODOリストへ追加する"
            disabled={aiBusy !== null}
            onClick={() => void handleExtractTodos()}
          >
            {aiBusy === "todo" ? "抽出中…" : "✅ TODO抽出"}
          </Button>
          <Button
            type="button"
            variant="soft"
            data-testid={`tag-note-${note.id}`}
            title="Geminiでこのノートにタグを付ける"
            disabled={aiBusy !== null}
            onClick={() => void handleTagThisNote()}
          >
            {aiBusy === "tag" ? "タグ付け中…" : "🏷️ タグ"}
          </Button>
          <Button
            type="button"
            variant="soft"
            data-testid={`copy-note-${note.id}`}
            title="このノートの本文をクリップボードにコピーする"
            onClick={() => void handleCopy()}
          >
            📋 コピー
          </Button>
          {DRIVE_SYNC_LABEL[driveSyncStatus] ? (
            <Text
              size="1"
              color="gray"
              data-testid={`drive-sync-status-${note.id}`}
              title="このノートのGoogle Drive自動同期の状態"
            >
              {DRIVE_SYNC_LABEL[driveSyncStatus]}
            </Text>
          ) : null}
        </Flex>
        {showHistory ? (
          <Suspense fallback={<div data-testid="history-loading">履歴を読み込み中…</div>}>
            <HistoryPanel
              key={`history-${note.id}`}
              noteId={note.id}
              currentContent={note.content}
              onRestore={(content) => {
                onNotesChange((prev) => updateNote(prev, note.id, { content }));
                setRestoreCounter((c) => c + 1);
              }}
            />
          </Suspense>
        ) : null}
        <Suspense fallback={<div data-testid="editor-loading">エディタを読み込み中…</div>}>
          {showPreview ? (
            <MarkdownPreview content={note.content} onNavigateToNote={onSelectNoteByTitle} />
          ) : (
            <Notepad
              key={`editor-${note.id}-${restoreCounter}`}
              content={note.content}
              autoFocus={autoFocus}
              onContentChange={(content) =>
                onNotesChange((prev) =>
                  updateNote(prev, note.id, { content, updatedAt: clockNow() }),
                )
              }
            />
          )}
        </Suspense>
        {note.tags && note.tags.length > 0 ? (
          <Flex gap="1" wrap="wrap" data-testid={`note-tags-${note.id}`}>
            {note.tags.map((tag) => (
              <Badge key={tag} color="indigo" variant="soft">
                #{tag}
              </Badge>
            ))}
          </Flex>
        ) : null}
        <BacklinksPanel notes={notes} activeNote={note} onSelectNote={onSelectNote} />
      </Flex>
    </Card>
  );
}
