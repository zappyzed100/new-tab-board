// NoteEditorPane.tsx — ノート編集エリア1件分(SPEC.md §4.2)
// 複数ノートを横並び表示する際、1ペイン=1コンポーネントインスタンスとして完全に独立させる
// (プレビュー/履歴表示・Drive同期状態はペインごとに別々でよい概念のため)。全文検索だけは
// 「全ノート横断」という性質上グローバル据え置き(App.tsx側のまま)。
import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Card, Flex, Text } from "@radix-ui/themes";
import { BacklinksPanel } from "./BacklinksPanel";
import { SnapshotScheduler } from "./SnapshotScheduler";
import { updateNote } from "../../../lib/entities/notes";
import { useDriveSync } from "../../../lib/drive/useDriveSync";
import { forceSnapshot } from "../../../lib/history/useSnapshotScheduler";
import type { Note } from "../../../types";

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
}: Props) {
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [restoreCounter, setRestoreCounter] = useState(0);

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
        <SnapshotScheduler noteId={note.id} content={note.content} />
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
                onNotesChange((prev) => updateNote(prev, note.id, { content }))
              }
            />
          )}
        </Suspense>
        <BacklinksPanel notes={notes} activeNote={note} onSelectNote={onSelectNote} />
      </Flex>
    </Card>
  );
}
