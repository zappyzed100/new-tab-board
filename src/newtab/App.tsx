// App.tsx — 新しいタブのルートコンポーネント(SPEC.md準拠の再構築中。M3以降で機能を積み上げる)
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BacklinksPanel } from "./components/BacklinksPanel";
import { BookmarkGrid } from "./components/BookmarkGrid";
import { Clock } from "./components/Clock";
import { CommandPalette } from "./components/CommandPalette";
import { DataPanel } from "./components/DataPanel";
import { MiniCalendar } from "./components/MiniCalendar";
import { NoteTabs } from "./components/NoteTabs";
import { Omnibar } from "./components/Omnibar";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { SnapshotScheduler } from "./components/SnapshotScheduler";
import { ThemeToggle } from "./components/ThemeToggle";
import { sortedBookmarks } from "../lib/bookmarks";
import { pickAndReadTextFile } from "../lib/fileSystem";
import { loadLocalData, loadSyncData, saveLocalData, saveSyncData } from "../lib/storage";
import { addNote, createNote, sortedNotes, updateNote } from "../lib/notes";
import {
  buildBookmarkJumpShortcuts,
  buildNoteJumpShortcuts,
  SHORTCUT_REGISTRY,
} from "../lib/shortcuts";
import { resolveTheme } from "../lib/theme";
import { forceSnapshot } from "../lib/useSnapshotScheduler";
import { useGlobalShortcuts } from "../lib/useGlobalShortcuts";
import type { AppLaunch, Bookmark, Note, Settings } from "../types";

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

// CodeMirror本体はサイズが大きいため動的importで分割し、初期描画をブロックしない
// (SPEC.md §8「新規タブは即座に描画」)。プレビュー用のmarkdown-it/DOMPurifyも同様。
const Notepad = lazy(() => import("./components/Notepad").then((m) => ({ default: m.Notepad })));
const MarkdownPreview = lazy(() =>
  import("./components/MarkdownPreview").then((m) => ({ default: m.MarkdownPreview })),
);
const HistoryPanel = lazy(() =>
  import("./components/HistoryPanel").then((m) => ({ default: m.HistoryPanel })),
);
const SearchPanel = lazy(() =>
  import("./components/SearchPanel").then((m) => ({ default: m.SearchPanel })),
);
const TodoPanel = lazy(() =>
  import("./components/TodoPanel").then((m) => ({ default: m.TodoPanel })),
);

export function App() {
  const [sync, setSync] = useState<SyncState | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showTodos, setShowTodos] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  // 履歴からの復元はNotepad(CM6)の内部エディタ状態を作り直す必要があるため、
  // 復元のたびにインクリメントしてNotepadのkeyへ含め、強制的に再マウントさせる
  // (通常の入力ではCM6側が真実の源であり、外部からのcontent変更を静かに無視する設計のため)。
  const [restoreCounter, setRestoreCounter] = useState(0);

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

  // notes/syncがnullの間もHooksは同じ順番で呼ぶ必要があるため、早期returnより前に
  // (SPEC.md §4.6の単一レジストリを)構築する。中身が空でも安全なようbuild*関数側でガードする。
  const orderedNotes = useMemo(() => (notes ? sortedNotes(notes) : []), [notes]);
  const orderedBookmarks = useMemo(() => (sync ? sortedBookmarks(sync.bookmarks) : []), [sync]);
  const activeNote = notes?.find((n) => n.id === activeNoteId) ?? null;

  const shortcutRegistry = useMemo(
    () => [
      ...SHORTCUT_REGISTRY,
      ...buildNoteJumpShortcuts(orderedNotes.length),
      ...buildBookmarkJumpShortcuts(orderedBookmarks.length),
    ],
    [orderedNotes.length, orderedBookmarks.length],
  );

  useGlobalShortcuts(shortcutRegistry, {
    commandPalette: () => setShowCommandPalette(true),
    toggleSearch: () => setShowSearch((v) => !v),
    cheatSheet: () => setShowShortcutsModal(true),
    immediateSnapshot: () => {
      if (activeNote) void forceSnapshot(activeNote.id, activeNote.content);
    },
    ...Object.fromEntries(
      orderedNotes.map((n, i) => [`noteJump-${i}`, () => setActiveNoteId(n.id)]),
    ),
    ...Object.fromEntries(
      orderedBookmarks.map((b, i) => [
        `bookmarkJump-${i}`,
        () => {
          if (sync?.settings.openIn === "new") window.open(b.url, "_blank", "noopener");
          else window.location.href = b.url;
        },
      ]),
    ),
  });

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

  function selectNoteByTitle(title: string) {
    // このコンポーネントはnotesがnullの間は上のearly returnで描画されないため、
    // ここに到達する時点でnotesは必ず非nullだが、クロージャ内ではTSが型を絞り込めない。
    const found = notes?.find((n) => n.title === title);
    if (found) setActiveNoteId(found.id);
  }

  return (
    <main data-testid="app-root">
      <Omnibar bookmarks={sync.bookmarks} appLaunches={sync.appLaunches} settings={sync.settings} />
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
      <button type="button" data-testid="toggle-search" onClick={() => setShowSearch((v) => !v)}>
        {showSearch ? "検索を閉じる" : "検索⌘F"}
      </button>
      <button type="button" data-testid="toggle-todos" onClick={() => setShowTodos((v) => !v)}>
        {showTodos ? "TODOを閉じる" : "TODO一覧"}
      </button>
      <button
        type="button"
        data-testid="open-command-palette"
        onClick={() => setShowCommandPalette(true)}
      >
        コマンド⌘K
      </button>
      <button
        type="button"
        data-testid="open-shortcuts-modal"
        onClick={() => setShowShortcutsModal(true)}
      >
        ショートカット一覧(?)
      </button>
      {showCommandPalette ? (
        <CommandPalette
          notes={notes}
          bookmarks={sync.bookmarks}
          appLaunches={sync.appLaunches}
          openIn={sync.settings.openIn}
          onSelectNote={setActiveNoteId}
          onClose={() => setShowCommandPalette(false)}
        />
      ) : null}
      {showShortcutsModal ? (
        <ShortcutsModal registry={shortcutRegistry} onClose={() => setShowShortcutsModal(false)} />
      ) : null}
      {showSearch ? (
        <Suspense fallback={<div data-testid="search-loading">検索を読み込み中…</div>}>
          <SearchPanel
            notes={notes}
            onSelectNote={(noteId) => {
              setActiveNoteId(noteId);
              setShowSearch(false);
            }}
          />
        </Suspense>
      ) : null}
      {showTodos ? (
        <Suspense fallback={<div data-testid="todos-loading">TODOを読み込み中…</div>}>
          <TodoPanel notes={notes} onSelectNote={setActiveNoteId} />
        </Suspense>
      ) : null}
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
          <button
            type="button"
            data-testid="toggle-history"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "履歴を閉じる" : "履歴🕑"}
          </button>
          <Suspense fallback={<div data-testid="editor-loading">エディタを読み込み中…</div>}>
            {showPreview ? (
              <MarkdownPreview content={activeNote.content} onNavigateToNote={selectNoteByTitle} />
            ) : (
              <Notepad
                key={`editor-${activeNote.id}-${restoreCounter}`}
                content={activeNote.content}
                onContentChange={(content) =>
                  updateNotes(updateNote(notes, activeNote.id, { content }))
                }
              />
            )}
            {showHistory ? (
              <HistoryPanel
                key={`history-${activeNote.id}`}
                noteId={activeNote.id}
                currentContent={activeNote.content}
                onRestore={(content) => {
                  updateNotes(updateNote(notes, activeNote.id, { content }));
                  setRestoreCounter((c) => c + 1);
                }}
              />
            ) : null}
          </Suspense>
          <BacklinksPanel notes={notes} activeNote={activeNote} onSelectNote={setActiveNoteId} />
        </div>
      ) : (
        <div data-testid="no-notes">ノートがありません</div>
      )}
    </main>
  );
}
