// App.tsx — 新しいタブのルートコンポーネント(SPEC.md準拠の再構築中。M3以降で機能を積み上げる)
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Container, Flex, Text, Theme } from "@radix-ui/themes";
import { BacklinksPanel } from "./components/notes/BacklinksPanel";
import { BookmarkGrid } from "./components/shell/BookmarkGrid";
import { Clock } from "./components/shell/Clock";
import { DataPanel } from "./components/shell/DataPanel";
import { MiniCalendar } from "./components/shell/MiniCalendar";
import { NoteTabs } from "./components/notes/NoteTabs";
import { ShortcutsModal } from "./components/discovery/ShortcutsModal";
import { SnapshotScheduler } from "./components/notes/SnapshotScheduler";
import { ThemeToggle } from "./components/shell/ThemeToggle";
import { TodoList } from "./components/shell/TodoList";
import { sortedBookmarks } from "../lib/entities/bookmarks";
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
import type { AppLaunch, Bookmark, LocalData, Note, Settings, Todo } from "../types";

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

export function App() {
  const [sync, setSync] = useState<SyncState | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // 検索はノート編集エリア内のトグル(プレビュー/履歴と同じ並び)——ホーム画面レベルの
  // 概念ではなく「今開いているノートに対する操作」として編集エリア側に置く。
  const [showSearch, setShowSearch] = useState(false);
  // データ管理はホーム画面レベルのトグル(アプリ全体のバックアップ/取り込み)。
  const [showData, setShowData] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [nextEventCache, setNextEventCache] = useState<LocalData["nextEventCache"]>(undefined);
  const [alarmActive, setAlarmActive] = useState(false);
  // resolveTheme()の解決結果("light"/"dark"。"auto"はメディアクエリで解決済みの値)を
  // document.documentElement.dataset.themeへの書き込みと同時にstateへも保持し、
  // Radixの<Theme appearance>propへ同じ値を配線する(二重の解決ロジックを作らない)。
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  // 履歴からの復元はNotepad(CM6)の内部エディタ状態を作り直す必要があるため、
  // 復元のたびにインクリメントしてNotepadのkeyへ含め、強制的に再マウントさせる
  // (通常の入力ではCM6側が真実の源であり、外部からのcontent変更を静かに無視する設計のため)。
  const [restoreCounter, setRestoreCounter] = useState(0);
  // 初回表示時はオムニバーへフォーカスしたい(検索にすぐ入れる新規タブらしい挙動)ので、
  // 「ユーザーが自分でノートを選んだ」時だけノート本文へオートフォーカスする
  // (それ以外=起動直後の自動選択ではフォーカスを奪わない)。
  const userSelectedNoteRef = useRef(false);
  function selectNote(noteId: string) {
    userSelectedNoteRef.current = true;
    setActiveNoteId(noteId);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSyncData(), loadLocalData()]).then(([syncData, localData]) => {
      if (cancelled) return;
      setSync(syncData);
      setNotes(localData.notes);
      setTodos(localData.todos ?? []);
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
    toggleSearch: () => setShowSearch((v) => !v),
    cheatSheet: () => setShowShortcutsModal(true),
    immediateSnapshot: () => {
      if (activeNote) void forceSnapshot(activeNote.id, activeNote.content);
      syncDriveNow(true);
    },
    ...Object.fromEntries(orderedNotes.map((n, i) => [`noteJump-${i}`, () => selectNote(n.id)])),
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
      const resolved = resolveTheme(sync.settings.theme, mql.matches);
      document.documentElement.dataset.theme = resolved;
      setResolvedTheme(resolved);
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
    // saveLocalDataはlocalData全体を1つのJSONとして上書きするため、他フィールド
    // (todos/nextEventCache/alarmActive)を巻き込まないよう現在値を明示的に含めて保存する
    // (含めずnotesだけ保存すると、ノートを1文字編集するたびにTODOリスト等が消えてしまう)。
    void saveLocalData({ notes: nextNotes, todos, nextEventCache, alarmActive });
    if (activeNoteId && !nextNotes.some((n) => n.id === activeNoteId)) {
      setActiveNoteId(nextNotes[0]?.id ?? null);
    }
  }

  function updateTodos(nextTodos: Todo[]) {
    setTodos(nextTodos);
    void saveLocalData({ notes: notes ?? [], todos: nextTodos, nextEventCache, alarmActive });
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
    void saveLocalData({ notes: data.notes, todos, nextEventCache, alarmActive });
  }

  function openFileAsNote(title: string, content: string) {
    if (!notes) return;
    const note = createNote(title, sortedNotes(notes).length);
    updateNotes(addNote(notes, { ...note, content }));
    selectNote(note.id);
  }

  const countdown = computeCountdown(nextEventCache, clockNow());

  if (!sync || !notes) {
    return (
      <Theme
        appearance={resolvedTheme}
        accentColor="indigo"
        grayColor="slate"
        radius="large"
        panelBackground="solid"
      >
        <div data-testid="app-loading">読み込み中…</div>
      </Theme>
    );
  }

  function selectNoteByTitle(title: string) {
    // このコンポーネントはnotesがnullの間は上のearly returnで描画されないため、
    // ここに到達する時点でnotesは必ず非nullだが、クロージャ内ではTSが型を絞り込めない。
    const found = notes?.find((n) => n.title === title);
    if (found) selectNote(found.id);
  }

  return (
    <Theme
      appearance={resolvedTheme}
      accentColor="indigo"
      grayColor="slate"
      radius="large"
      panelBackground="solid"
    >
      <Container size="4" p={{ initial: "3", sm: "5" }}>
        <Flex asChild direction="column" gap="4">
          <main data-testid="app-root">
            {countdown.kind === "upcoming" ? (
              <Card data-testid="next-event-countdown" title="Googleカレンダーの次の予定まで">
                <Text size="3" weight="medium">
                  📆 次の予定まで {countdown.minutes}分({countdown.title})
                </Text>
              </Card>
            ) : null}
            {countdown.kind === "in-progress" ? (
              <Card data-testid="next-event-countdown">
                <Text size="3" weight="medium">
                  📆 予定は進行中です
                </Text>
              </Card>
            ) : null}
            {alarmActive ? (
              <Button
                type="button"
                color="red"
                data-testid="stop-pre-event-alarm"
                title="予定10分前アラームの音を止める"
                onClick={stopPreEventAlarm}
              >
                🔔 アラーム停止
              </Button>
            ) : null}

            <Flex asChild align="center" gap="4" wrap="wrap">
              <header>
                <Clock />
                <ThemeToggle
                  theme={sync.settings.theme}
                  onThemeChange={(theme) => updateSettings({ theme })}
                />
              </header>
            </Flex>

            <Flex asChild align="center" gap="3" wrap="wrap">
              <nav>
                <Button
                  type="button"
                  variant={showData ? "solid" : "soft"}
                  aria-pressed={showData}
                  data-testid="toggle-data"
                  title="全データのJSON書き出し/取り込み・ローカルファイル操作・NAS設定"
                  onClick={() => setShowData((v) => !v)}
                >
                  🗄️ {showData ? "データ管理を閉じる" : "データ管理"}
                </Button>

                <Flex gap="2" pl="3" style={{ borderLeft: "1px solid var(--gray-a5)" }}>
                  <Button
                    type="button"
                    variant="soft"
                    data-testid="open-shortcuts-modal"
                    title="使えるキーボードショートカットの一覧を表示する"
                    onClick={() => setShowShortcutsModal(true)}
                  >
                    ⌨️ ショートカット一覧(?)
                  </Button>
                </Flex>

                {activeNote && DRIVE_SYNC_LABEL[driveSyncStatus] ? (
                  <Text
                    size="1"
                    color="gray"
                    data-testid="drive-sync-status"
                    title="このノートのGoogle Drive自動同期の状態"
                  >
                    {DRIVE_SYNC_LABEL[driveSyncStatus]}
                  </Text>
                ) : null}
              </nav>
            </Flex>

            {showData ? (
              <DataPanel
                sync={sync}
                notes={notes}
                onImportData={importData}
                onOpenFileAsNote={openFileAsNote}
              />
            ) : null}
            {showShortcutsModal ? (
              <ShortcutsModal
                registry={shortcutRegistry}
                onClose={() => setShowShortcutsModal(false)}
              />
            ) : null}

            <div className="app-main">
              <div className="app-sidebar">
                <BookmarkGrid
                  bookmarks={sync.bookmarks}
                  openIn={sync.settings.openIn}
                  onBookmarksChange={updateBookmarks}
                />
                <MiniCalendar />
                <TodoList todos={todos} onTodosChange={updateTodos} />
              </div>
              <section className="app-notes">
                <NoteTabs
                  notes={notes}
                  activeNoteId={activeNoteId}
                  onNotesChange={updateNotes}
                  onSelect={selectNote}
                />
                {activeNote ? (
                  <Card data-testid="note-editor-area">
                    <Flex direction="column" gap="3">
                      <SnapshotScheduler
                        key={activeNote.id}
                        noteId={activeNote.id}
                        content={activeNote.content}
                      />
                      <Flex align="center" gap="3" wrap="wrap">
                        <Button
                          type="button"
                          variant={showPreview ? "solid" : "soft"}
                          data-testid="toggle-preview"
                          title="Markdown記法(見出し・リスト等)を清書して表示する"
                          onClick={() => setShowPreview((v) => !v)}
                        >
                          {showPreview ? "編集に戻る" : "Markdownプレビュー"}
                        </Button>
                        <Button
                          type="button"
                          variant={showHistory ? "solid" : "soft"}
                          data-testid="toggle-history"
                          title="過去のスナップショット一覧・差分表示・復元"
                          onClick={() => setShowHistory((v) => !v)}
                        >
                          🕑 {showHistory ? "履歴を閉じる" : "履歴"}
                        </Button>
                        <Button
                          type="button"
                          variant={showSearch ? "solid" : "soft"}
                          aria-pressed={showSearch}
                          data-testid="toggle-search"
                          title="全ノートの本文を横断して全文検索する(Cmd/Ctrl+F)"
                          onClick={() => setShowSearch((v) => !v)}
                        >
                          🔍 {showSearch ? "検索を閉じる" : "検索(Ctrl+F)"}
                        </Button>
                      </Flex>
                      {showSearch ? (
                        <Suspense
                          fallback={<div data-testid="search-loading">検索を読み込み中…</div>}
                        >
                          <SearchPanel
                            notes={notes}
                            onSelectNote={(noteId) => {
                              selectNote(noteId);
                              setShowSearch(false);
                            }}
                          />
                        </Suspense>
                      ) : null}
                      {showHistory ? (
                        <Suspense
                          fallback={<div data-testid="history-loading">履歴を読み込み中…</div>}
                        >
                          <HistoryPanel
                            key={`history-${activeNote.id}`}
                            noteId={activeNote.id}
                            currentContent={activeNote.content}
                            onRestore={(content) => {
                              updateNotes(updateNote(notes, activeNote.id, { content }));
                              setRestoreCounter((c) => c + 1);
                            }}
                          />
                        </Suspense>
                      ) : null}
                      <Suspense
                        fallback={<div data-testid="editor-loading">エディタを読み込み中…</div>}
                      >
                        {showPreview ? (
                          <MarkdownPreview
                            content={activeNote.content}
                            onNavigateToNote={selectNoteByTitle}
                          />
                        ) : (
                          <Notepad
                            key={`editor-${activeNote.id}-${restoreCounter}`}
                            content={activeNote.content}
                            autoFocus={userSelectedNoteRef.current}
                            onContentChange={(content) =>
                              updateNotes(updateNote(notes, activeNote.id, { content }))
                            }
                          />
                        )}
                      </Suspense>
                      <BacklinksPanel
                        notes={notes}
                        activeNote={activeNote}
                        onSelectNote={selectNote}
                      />
                    </Flex>
                  </Card>
                ) : (
                  <Card data-testid="no-notes">
                    <Text size="3" weight="medium" color="indigo">
                      📝 ノートがありません。上の「+ ノート」ボタンを押すと書き始められます
                    </Text>
                  </Card>
                )}
              </section>
            </div>
          </main>
        </Flex>
      </Container>
    </Theme>
  );
}
