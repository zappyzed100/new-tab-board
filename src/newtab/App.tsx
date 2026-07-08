// App.tsx — 新しいタブのルートコンポーネント(SPEC.md準拠の再構築中。M3以降で機能を積み上げる)
import { lazy, Suspense, useEffect, useState } from "react";
import { BookmarkGrid } from "./components/BookmarkGrid";
import { NoteTabs } from "./components/NoteTabs";
import { SnapshotScheduler } from "./components/SnapshotScheduler";
import { loadLocalData, loadSyncData, saveLocalData, saveSyncData } from "../lib/storage";
import { updateNote } from "../lib/notes";
import type { AppLaunch, Bookmark, Note, Settings } from "../types";

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

// CodeMirror本体はサイズが大きいため動的importで分割し、初期描画をブロックしない
// (SPEC.md §8「新規タブは即座に描画」)。プレビュー用のmarkdown-it/DOMPurifyも同様。
const Notepad = lazy(() => import("./components/Notepad").then((m) => ({ default: m.Notepad })));
const MarkdownPreview = lazy(() =>
  import("./components/MarkdownPreview").then((m) => ({ default: m.MarkdownPreview })),
);

export function App() {
  const [sync, setSync] = useState<SyncState | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSyncData(), loadLocalData()]).then(([syncData, localData]) => {
      if (cancelled) return;
      setSync(syncData);
      setNotes(localData.notes);
      setActiveNoteId(localData.notes[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateBookmarks(bookmarks: Bookmark[]) {
    if (!sync) return;
    const next = { ...sync, bookmarks };
    setSync(next);
    void saveSyncData(next);
  }

  function updateNotes(nextNotes: Note[]) {
    setNotes(nextNotes);
    void saveLocalData({ notes: nextNotes });
    if (activeNoteId && !nextNotes.some((n) => n.id === activeNoteId)) {
      setActiveNoteId(nextNotes[0]?.id ?? null);
    }
  }

  if (!sync || !notes) {
    return <div data-testid="app-loading">読み込み中…</div>;
  }

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  return (
    <main data-testid="app-root">
      <BookmarkGrid
        bookmarks={sync.bookmarks}
        openIn={sync.settings.openIn}
        onBookmarksChange={updateBookmarks}
      />
      <NoteTabs
        notes={notes}
        activeNoteId={activeNoteId}
        onNotesChange={updateNotes}
        onSelect={setActiveNoteId}
      />
      {activeNote ? (
        <div data-testid="note-editor-area">
          <SnapshotScheduler
            key={activeNote.id}
            noteId={activeNote.id}
            content={activeNote.content}
          />
          <button
            type="button"
            data-testid="toggle-preview"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? "編集に戻る" : "プレビュー"}
          </button>
          <Suspense fallback={<div data-testid="editor-loading">エディタを読み込み中…</div>}>
            {showPreview ? (
              <MarkdownPreview content={activeNote.content} />
            ) : (
              <Notepad
                key={activeNote.id}
                content={activeNote.content}
                onContentChange={(content) =>
                  updateNotes(updateNote(notes, activeNote.id, { content }))
                }
              />
            )}
          </Suspense>
        </div>
      ) : (
        <div data-testid="no-notes">ノートがありません</div>
      )}
    </main>
  );
}
