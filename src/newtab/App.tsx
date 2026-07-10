// App.tsx — 新しいタブのルートコンポーネント(SPEC.md準拠の再構築中。M3以降で機能を積み上げる)
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BacklinksPanel } from "./components/notes/BacklinksPanel";
import { BookmarkGrid } from "./components/shell/BookmarkGrid";
import { Clock } from "./components/shell/Clock";
import { CommandPalette } from "./components/discovery/CommandPalette";
import { DataPanel } from "./components/shell/DataPanel";
import { MiniCalendar } from "./components/shell/MiniCalendar";
import { NoteTabs } from "./components/notes/NoteTabs";
import { Omnibar } from "./components/discovery/Omnibar";
import { ShortcutsModal } from "./components/discovery/ShortcutsModal";
import { SnapshotScheduler } from "./components/notes/SnapshotScheduler";
import { ThemeToggle } from "./components/shell/ThemeToggle";
import { sortedBookmarks } from "../lib/entities/bookmarks";
import { pickAndReadTextFile } from "../lib/fileio/fileSystem";
import { loadLocalData, loadSyncData, saveLocalData, saveSyncData } from "../lib/storage/storage";
import { addNote, createNote, sortedNotes, updateNote } from "../lib/entities/notes";
import {
  buildBookmarkJumpShortcuts,
  buildNoteJumpShortcuts,
  SHORTCUT_REGISTRY,
} from "../lib/shortcuts/shortcuts";
import { resolveTheme } from "../lib/display/theme";
import { now as clockNow } from "../lib/runtime/clock";
import { computeCountdown } from "../lib/nextEvent/nextEventCountdown";
import { flushAllToNas } from "../lib/externalIO/nasArchive";
import { pullPendingFile } from "../lib/externalIO/nativeMessaging";
import { forceSnapshot } from "../lib/history/useSnapshotScheduler";
import { useDriveSync } from "../lib/drive/useDriveSync";
import { useGlobalShortcuts } from "../lib/shortcuts/useGlobalShortcuts";
import type { AppLaunch, Bookmark, LocalData, Note, Settings } from "../types";

const DRIVE_SYNC_LABEL: Record<string, string> = {
  idle: "",
  syncing: "同期中…",
  synced: "☁同期済",
  unauthenticated: "Drive未認証",
  error: "同期エラー",
};

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

// CodeMirror本体はサイズが大きいため動的importで分割し、初期描画をブロックしない
// (SPEC.md §8「新規タブは即座に描画」)。プレビュー用のmarkdown-it/DOMPurifyも同様。
const Notepad = lazy(() =>
  import("./components/notes/Notepad").then((m) => ({ default: m.Notepad })),
);
const MarkdownPreview = lazy(() =>
  import("./components/notes/MarkdownPreview").then((m) => ({ default: m.MarkdownPreview })),
);
const HistoryPanel = lazy(() =>
  import("./components/notes/HistoryPanel").then((m) => ({ default: m.HistoryPanel })),
);
const SearchPanel = lazy(() =>
  import("./components/discovery/SearchPanel").then((m) => ({ default: m.SearchPanel })),
);
const TodoPanel = lazy(() =>
  import("./components/discovery/TodoPanel").then((m) => ({ default: m.TodoPanel })),
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
  const [showCalendar, setShowCalendar] = useState(false);
  const [showData, setShowData] = useState(false);
  const [nextEventCache, setNextEventCache] = useState<LocalData["nextEventCache"]>(undefined);
  const [alarmActive, setAlarmActive] = useState(false);
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
      setNextEventCache(localData.nextEventCache);
      setAlarmActive(localData.alarmActive ?? false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 新規タブページが開いたタイミングでNASフォルダの権限確認→有効なうちにフラッシュを
  // 試行する(SPEC.md §4.3。File System Accessはservice workerでは使えないためnew-tab
  // 文脈でのみ実行できる。NAS未設定/権限無し/到達不可はnasArchive.ts側で静かに0件扱い)。
  useEffect(() => {
    void flushAllToNas();
  }, []);

  // 新規タブページが開くたびにFlow Launcher(native messaging host)へ接続し、
  // 保留中のファイルがあれば新規ノートとして取り込む(SPEC.md §4.10-d「pull型」)。
  // notesの初回ロード完了を待ってから1回だけ実行する(pulledRefで再発火を防ぐ)。
  const pulledFileRef = useRef(false);
  useEffect(() => {
    if (!notes || pulledFileRef.current) return;
    pulledFileRef.current = true;
    void pullPendingFile().then((result) => {
      if (result) openFileAsNote(result.name.replace(/\.txt$/i, ""), result.content);
    });
  }, [notes]);

  // background.tsが数分おきに更新するnextEventCacheを取り込みつつ、カウントダウン表示を
  // 定期的に再計算させる(SPEC.md §4.9「毎秒/毎分再計算」。30秒間隔で分単位の精度は満たす)。
  // alarmActiveもここで併せて反映し、予定前アラーム鳴動中は停止ボタンを表示する(§4.11)。
  useEffect(() => {
    const interval = setInterval(() => {
      void loadLocalData().then((local) => {
        setNextEventCache(local.nextEventCache);
        setAlarmActive(local.alarmActive ?? false);
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  function stopPreEventAlarm() {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "stop-pre-event-alarm" });
    }
    setAlarmActive(false);
    // background.tsのstopAlarm()を待たず、UI側でも即座に永続化する(30秒間隔の
    // 定期リフレッシュが古いalarmActive:trueを読み直して復活させるのを防ぐため)。
    void loadLocalData().then((local) => saveLocalData({ ...local, alarmActive: false }));
  }

  // notes/syncがnullの間もHooksは同じ順番で呼ぶ必要があるため、早期returnより前に
  // (SPEC.md §4.6の単一レジストリを)構築する。中身が空でも安全なようbuild*関数側でガードする。
  const orderedNotes = useMemo(() => (notes ? sortedNotes(notes) : []), [notes]);
  const orderedBookmarks = useMemo(() => (sync ? sortedBookmarks(sync.bookmarks) : []), [sync]);
  const activeNote = notes?.find((n) => n.id === activeNoteId) ?? null;

  const { status: driveSyncStatus, syncNow: syncDriveNow } = useDriveSync(
    activeNote,
    (driveFileId, lastSyncedAt) => {
      if (notes && activeNote) {
        updateNotes(updateNote(notes, activeNote.id, { driveFileId, lastSyncedAt }));
      }
    },
  );

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
      syncDriveNow(true);
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

  // テーマ(light/dark/auto)の解決結果をdocument.documentElementへ反映する。
  useEffect(() => {
    if (!sync) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    function applyTheme() {
      if (!sync) return;
      document.documentElement.dataset.theme = resolveTheme(sync.settings.theme, mql.matches);
    }
    applyTheme();
    mql.addEventListener("change", applyTheme);
    return () => mql.removeEventListener("change", applyTheme);
  }, [sync]);

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

  function updateSettings(patch: Partial<Settings>) {
    if (!sync) return;
    const next = { ...sync, settings: { ...sync.settings, ...patch } };
    setSync(next);
    void saveSyncData(next);
  }

  function importData(data: { sync: SyncState; notes: Note[] }) {
    setSync(data.sync);
    setNotes(data.notes);
    setActiveNoteId(data.notes[0]?.id ?? null);
    void saveSyncData(data.sync);
    void saveLocalData({ notes: data.notes });
  }

  function openFileAsNote(title: string, content: string) {
    if (!notes) return;
    const note = createNote(title, sortedNotes(notes).length);
    updateNotes(addNote(notes, { ...note, content }));
    setActiveNoteId(note.id);
  }

  const countdown = computeCountdown(nextEventCache, clockNow());

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
      {countdown.kind === "upcoming" ? (
        <div data-testid="next-event-countdown">
          次の予定まで {countdown.minutes}分({countdown.title})
        </div>
      ) : null}
      {countdown.kind === "in-progress" ? (
        <div data-testid="next-event-countdown">予定は進行中です</div>
      ) : null}
      {alarmActive ? (
        <button type="button" data-testid="stop-pre-event-alarm" onClick={stopPreEventAlarm}>
          アラーム停止
        </button>
      ) : null}

      <header className="app-header">
        <Clock />
        <Omnibar
          bookmarks={sync.bookmarks}
          appLaunches={sync.appLaunches}
          settings={sync.settings}
        />
        <ThemeToggle
          theme={sync.settings.theme}
          onThemeChange={(theme) => updateSettings({ theme })}
        />
      </header>

      <nav className="app-toolbar">
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
        <button
          type="button"
          data-testid="toggle-calendar"
          onClick={() => setShowCalendar((v) => !v)}
        >
          {showCalendar ? "カレンダーを閉じる" : "カレンダー"}
        </button>
        <button type="button" data-testid="toggle-data" onClick={() => setShowData((v) => !v)}>
          {showData ? "データ管理を閉じる" : "データ管理"}
        </button>
        {activeNote && DRIVE_SYNC_LABEL[driveSyncStatus] ? (
          <span data-testid="drive-sync-status">{DRIVE_SYNC_LABEL[driveSyncStatus]}</span>
        ) : null}
      </nav>

      <div className="app-overlays">
        {showCalendar ? <MiniCalendar /> : null}
        {showData ? (
          <DataPanel
            sync={sync}
            notes={notes}
            onImportData={importData}
            onOpenFileAsNote={openFileAsNote}
          />
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
      </div>

      {showCommandPalette ? (
        <CommandPalette
          notes={notes}
          bookmarks={sync.bookmarks}
          appLaunches={sync.appLaunches}
          openIn={sync.settings.openIn}
          onSelectNote={setActiveNoteId}
          onOpenFile={() =>
            void pickAndReadTextFile().then(
              (r) => r && openFileAsNote(r.name.replace(/\.txt$/i, ""), r.content),
            )
          }
          onClose={() => setShowCommandPalette(false)}
        />
      ) : null}
      {showShortcutsModal ? (
        <ShortcutsModal registry={shortcutRegistry} onClose={() => setShowShortcutsModal(false)} />
      ) : null}

      <div className="app-main">
        <BookmarkGrid
          bookmarks={sync.bookmarks}
          openIn={sync.settings.openIn}
          onBookmarksChange={updateBookmarks}
        />
        <section className="app-notes">
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
              <div className="app-toolbar">
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
              </div>
              <Suspense fallback={<div data-testid="editor-loading">エディタを読み込み中…</div>}>
                {showPreview ? (
                  <MarkdownPreview
                    content={activeNote.content}
                    onNavigateToNote={selectNoteByTitle}
                  />
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
              <BacklinksPanel
                notes={notes}
                activeNote={activeNote}
                onSelectNote={setActiveNoteId}
              />
            </div>
          ) : (
            <div data-testid="no-notes">ノートがありません</div>
          )}
        </section>
      </div>
    </main>
  );
}
