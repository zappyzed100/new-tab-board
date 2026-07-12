// App.tsx — 新しいタブのルートコンポーネント(SPEC.md準拠の再構築中。M3以降で機能を積み上げる)
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Card, Flex, Text, Theme } from "@radix-ui/themes";
import { BookmarkGrid } from "./components/shell/BookmarkGrid";
import { Clock } from "./components/shell/Clock";
import { DataPanel } from "./components/shell/DataPanel";
import { MiniCalendar } from "./components/shell/MiniCalendar";
import { NoteEditorPane } from "./components/notes/NoteEditorPane";
import { NoteTabs } from "./components/notes/NoteTabs";
import { ShortcutsModal } from "./components/discovery/ShortcutsModal";
import { TagSearchPanel } from "./components/discovery/TagSearchPanel";
import { ThemeToggle } from "./components/shell/ThemeToggle";
import { TodoList } from "./components/shell/TodoList";
import { sortedBookmarks } from "../lib/entities/bookmarks";
import { loadLocalData, loadSyncData, saveLocalData, saveSyncData } from "../lib/storage/storage";
import {
  addNote,
  createNote,
  MAX_VISIBLE_NOTES,
  resolveVisibleNoteIds,
  sortedNotes,
  updateNote,
} from "../lib/entities/notes";
import { getGeminiApiKey } from "../lib/storage/db";
import { analyzeNote, contentHash, needsRetag } from "../lib/gemini/tagging";
import { buildExportPayload, serializeExport } from "../lib/fileio/exportImport";
import {
  buildBookmarkJumpShortcuts,
  buildNoteJumpShortcuts,
  SHORTCUT_REGISTRY,
} from "../lib/shortcuts/shortcuts";
import { resolveTheme } from "../lib/display/theme";
import { clampNoteFontSize, NOTE_FONT_DEFAULT, NOTE_FONT_STEP } from "../lib/display/noteFont";
import { now as clockNow } from "../lib/runtime/clock";
import { computeCountdown, formatCountdown } from "../lib/nextEvent/nextEventCountdown";
import {
  flushAllToNas,
  writeActiveNotesToNas,
  writeNoteMarkdownToNas,
} from "../lib/externalIO/nasArchive";
import { pullPendingFile } from "../lib/externalIO/nativeMessaging";
import { useJsonBackupSync } from "../lib/drive/useJsonBackupSync";
import { useGlobalShortcuts } from "../lib/shortcuts/useGlobalShortcuts";
import type { AppLaunch, Bookmark, LocalData, Note, Settings, Todo } from "../types";

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

// 全文検索は「全ノート横断」の性質上、複数ペイン表示でも唯一グローバルのまま
// (プレビュー/履歴/エディタ本体はNoteEditorPane側でペインごとに動的import)。
const SearchPanel = lazy(() =>
  import("./components/discovery/SearchPanel").then((m) => ({ default: m.SearchPanel })),
);

export function App() {
  const [sync, setSync] = useState<SyncState | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  // 4件以上ある時だけ意味を持つ「表示する3件」のユーザー選択(3件以下なら常に全件
  // 表示のため無視される。resolveVisibleNoteIdsが実際に描画する集合へ解決する)。
  const [requestedVisibleIds, setRequestedVisibleIds] = useState<string[]>([]);
  // 全文検索バーは常時表示(開閉トグルは撤去済み——ユーザー指示)。Cmd/Ctrl+Fは
  // この検索欄へフォーカスを移す操作として再割り当てする(下のsearchInputRef参照)。
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  // DataPanelの結果メッセージはここで持つ(DataPanel内で持つと、隣接する
  // 「ショートカット一覧」ボタンと同じflexコンテナに並ぶwidth:100%のメッセージが
  // メッセージの有無でショートカットボタンの位置をガタつかせるため、ソースコード上も
  // ショートカットボタンより後ろに置く——ユーザー指摘)。
  const [dataPanelMessage, setDataPanelMessage] = useState<string | null>(null);
  const [nextEventCache, setNextEventCache] = useState<LocalData["nextEventCache"]>(undefined);
  const [alarmActive, setAlarmActive] = useState(false);
  // resolveTheme()の解決結果("light"/"dark"。"auto"はメディアクエリで解決済みの値)を
  // document.documentElement.dataset.themeへの書き込みと同時にstateへも保持し、
  // Radixの<Theme appearance>propへ同じ値を配線する(二重の解決ロジックを作らない)。
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  // Cmd/Ctrl+Sで「見えている全ペイン」に即時スナップショット+Drive同期をキックする
  // ための共有シグナル(各NoteEditorPaneがこの値の変化をuseEffectで監視する)。
  const [manualSyncSignal, setManualSyncSignal] = useState(0);
  // 「🏷️ タグをふる」実行中フラグ(二重起動防止・ラベル切替)。
  const [tagging, setTagging] = useState(false);
  // 初回表示時はオムニバーへフォーカスしたい(検索にすぐ入れる新規タブらしい挙動)ので、
  // 「ユーザーが自分でノートを選んだ」時だけノート本文へオートフォーカスする
  // (それ以外=起動直後の自動選択ではフォーカスを奪わない)。
  const userSelectedNoteRef = useRef(false);
  function selectNote(noteId: string) {
    userSelectedNoteRef.current = true;
    setActiveNoteId(noteId);
    // 横並び表示にも入れる(上限に達していれば最も古いものと入れ替える)。
    setRequestedVisibleIds((prev) =>
      prev.includes(noteId)
        ? prev
        : prev.length >= MAX_VISIBLE_NOTES
          ? [...prev.slice(1), noteId]
          : [...prev, noteId],
    );
  }

  // タブクリック(selectNote)と違い、チェックボックスでの明示的な選択操作は
  // 「入りきらないから何かを追い出す」ことをせず、単純な追加/削除にとどめる
  // (これにより0件・1件・2件・3件のどの表示数もユーザーの意図どおりに選べる)。
  function toggleVisible(noteId: string) {
    setRequestedVisibleIds((prev) =>
      prev.includes(noteId)
        ? prev.filter((id) => id !== noteId)
        : prev.length >= MAX_VISIBLE_NOTES
          ? prev
          : [...prev, noteId],
    );
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSyncData(), loadLocalData()]).then(([syncData, localData]) => {
      if (cancelled) return;
      setSync(syncData);
      setNotes(localData.notes);
      setTodos(localData.todos ?? []);
      setActiveNoteId(localData.notes[0]?.id ?? null);
      // 4件以上あるノートの初期表示。resolveVisibleNoteIdsはもう自動補完しないため、
      // 何も指定しないと初回表示が0件になってしまう——表示順の先頭3件を既定値として
      // シードする(以前の「常に3件表示」だった挙動に近い、素直な初期状態)。
      setRequestedVisibleIds(
        sortedNotes(localData.notes)
          .slice(0, 3)
          .map((n) => n.id),
      );
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

  // 「出先で確認」用に、ボード上の全ノートを単一ファイル(active/New Tab Board.txt)へ
  // debounce付きで自動ミラーする(ファイル名固定・各ノートはtitle見出し付き——ユーザー指示)。
  // notesが変わるたび(=編集のたび)に再計算されるpayloadを依存にし、3秒静止してから書く。
  const activeNotesPayload = useMemo(
    () => (notes ? sortedNotes(notes).map((n) => ({ title: n.title, body: n.content })) : []),
    [notes],
  );
  useEffect(() => {
    if (activeNotesPayload.length === 0) return;
    const timer = setTimeout(() => void writeActiveNotesToNas(activeNotesPayload), 3000);
    return () => clearTimeout(timer);
  }, [activeNotesPayload]);

  // タグ検索の正本として、各ノートを notes/<id>.md (YAML front matter付き) へ書き出す(ユーザー設計)。
  // 空・ゴミ(junk)判定ノートは書かない。変更のあったノートだけ書く(全501件を毎回書かない)。
  const noteMdSigRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!notes) return;
    const timer = setTimeout(() => {
      void (async () => {
        for (const n of notes) {
          if (n.content.trim() === "" || n.junk) continue;
          const sig = `${n.title} ${n.content} ${(n.tags ?? []).join(",")} ${n.updatedAt ?? ""}`;
          if (noteMdSigRef.current.get(n.id) === sig) continue;
          if (await writeNoteMarkdownToNas(n)) noteMdSigRef.current.set(n.id, sig);
        }
      })();
    }, 3000);
    return () => clearTimeout(timer);
  }, [notes]);

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
  // 横並び表示する最大3件(3件以下なら全件・4件以上ならrequestedVisibleIds+自動補完)。
  const visibleNoteIds = useMemo(
    () => resolveVisibleNoteIds(orderedNotes, requestedVisibleIds),
    [orderedNotes, requestedVisibleIds],
  );
  const visibleNotes = visibleNoteIds
    .map((id) => notes?.find((n) => n.id === id))
    .filter((n): n is Note => n !== undefined);

  // 全データ(ブックマーク/ノート/設定/TODO)のJSONバックアップをdebounce付きで自動的に
  // Driveへ同期する(ボタン操作不要。ノート本文の自動同期と同じ頻度・同じ設計思想)。
  // exportedAtは常に変わるため、sync/notesが変化した時だけ再計算してdebounceを安定させる。
  const backupJson = useMemo(() => {
    if (!sync || !notes) return null;
    return serializeExport(buildExportPayload(sync, notes, clockNow()));
  }, [sync, notes]);
  useJsonBackupSync(backupJson, sync?.settings.jsonBackupFileId, (fileId) =>
    updateSettings({ jsonBackupFileId: fileId }),
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
    toggleSearch: () => searchInputRef.current?.focus(),
    cheatSheet: () => setShowShortcutsModal(true),
    // 表示中の全ペイン(NoteEditorPane)がmanualSyncSignalの変化を検知し、
    // それぞれ自分のノートを即時スナップショット+Drive同期する。
    immediateSnapshot: () => setManualSyncSignal((v) => v + 1),
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

  // ノート本文の文字サイズ(px)をCSS変数--note-font-sizeへ流し込む(styles.cssの.cm-editorが参照)。
  // ノート以外のUI文字には影響しない(ユーザー指示)。未設定なら既定値。
  const noteFontSize = clampNoteFontSize(sync?.settings.noteFontSize ?? NOTE_FONT_DEFAULT);
  useEffect(() => {
    document.documentElement.style.setProperty("--note-font-size", `${noteFontSize}px`);
  }, [noteFontSize]);
  function changeNoteFontSize(delta: number) {
    updateSettings({ noteFontSize: clampNoteFontSize(noteFontSize + delta) });
  }

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

  function updateNotes(update: Note[] | ((prev: Note[]) => Note[])) {
    // 常にsetNotesの関数型updaterを経由する(引数が配列であっても内部で関数化する)。
    // 「タブ追加ボタンを連打すると作ったノートが消える」バグの原因は、複数の呼び出しが
    // それぞれ古いclosure内のnotes(propsとして渡された時点のスナップショット)から
    // 新しい配列を計算し、後勝ちでsetNotesしていたこと(1個目の追加が2個目の呼び出しの
    // 計算元に含まれておらず上書きされて消えていた)。Reactは関数型updaterを
    // キューされた順に必ず正しいprevへ適用するため、呼び出しが連続してもデータが
    // 失われない。
    setNotes((prev) => {
      const base = prev ?? [];
      const nextNotes = typeof update === "function" ? update(base) : update;
      // saveLocalDataはlocalData全体を1つのJSONとして上書きするため、他フィールド
      // (todos/nextEventCache/alarmActive)を巻き込まないよう現在値を明示的に含めて
      // 保存する(含めずnotesだけ保存すると、ノートを1文字編集するたびにTODOリスト等が
      // 消えてしまう)。
      void saveLocalData({ notes: nextNotes, todos, nextEventCache, alarmActive });
      if (activeNoteId && !nextNotes.some((n) => n.id === activeNoteId)) {
        setActiveNoteId(nextNotes[0]?.id ?? null);
      }
      return nextNotes;
    });
  }

  function updateTodos(nextTodos: Todo[]) {
    setTodos(nextTodos);
    void saveLocalData({ notes: notes ?? [], todos: nextTodos, nextEventCache, alarmActive });
  }

  // 「🏷️ タグをふる」で全ノートにGeminiタグを付ける。前回タグ付け以降変更のないノートは
  // スキップする(needsRetag。ユーザー指示「変化なしのファイルは再タグ付け不要」)。
  async function handleTagAll() {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      setDataPanelMessage("Gemini APIキーを設定してください(データ管理の🔑ボタン)");
      return;
    }
    const all = notes ?? [];
    const targets = all.filter(needsRetag);
    if (targets.length === 0) {
      setDataPanelMessage("タグ付けが必要なノートはありません(変更なしのためスキップ)");
      return;
    }
    setTagging(true);
    setDataPanelMessage(`${targets.length}件のノートにGeminiでタグ付け中…`);
    let done = 0;
    let junkCount = 0;
    for (const note of targets) {
      const { tags, junk } = await analyzeNote(note.content, apiKey);
      if (tags.length > 0 || junk) {
        const hash = contentHash(note.content);
        updateNotes((prev) => updateNote(prev, note.id, { tags, junk, taggedHash: hash }));
        done += 1;
        if (junk) junkCount += 1;
      }
    }
    setTagging(false);
    setDataPanelMessage(
      `タグ付け完了: ${done}件に付与(未変更でスキップ${all.length - targets.length}件` +
        `${junkCount > 0 ? `・ゴミ判定${junkCount}件はNAS保管対象外` : ""})`,
    );
  }

  // GeminiのTODO抽出結果をTODOリスト末尾へ追加する(order連番を振り直す)。
  function addTodos(texts: string[]) {
    const startOrder = todos.length;
    const appended: Todo[] = texts.map((text, i) => ({
      id: crypto.randomUUID(),
      text,
      done: false,
      order: startOrder + i,
    }));
    updateTodos([...todos, ...appended]);
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

  function openFileAsNote(
    title: string,
    content: string,
    meta?: { sourceNoteId?: string; generatedBy?: string },
  ) {
    const note = createNote(title, sortedNotes(notes ?? []).length, clockNow());
    updateNotes((prev) => addNote(prev, { ...note, content, ...meta }));
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
      <Box p={{ initial: "3", sm: "5" }}>
        <Flex asChild direction="column" gap="4">
          <main data-testid="app-root">
            {countdown.kind === "upcoming" ? (
              <Card data-testid="next-event-countdown" title="Googleカレンダーの次の予定まで">
                <Text size="3" weight="medium">
                  📆 次の予定まで {formatCountdown(countdown)}({countdown.title})
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

            <BookmarkGrid
              bookmarks={sync.bookmarks}
              openIn={sync.settings.openIn}
              onBookmarksChange={updateBookmarks}
            />

            <Flex asChild align="center" gap="3" wrap="wrap">
              <nav>
                <DataPanel
                  sync={sync}
                  onImportData={importData}
                  onOpenFileAsNote={openFileAsNote}
                  onMessage={setDataPanelMessage}
                />

                {/* ヘルプ系は使用頻度が低いため、日常操作のボタン群より右に置く(ユーザー指示)。 */}
                <Button
                  type="button"
                  variant="soft"
                  data-testid="open-shortcuts-modal"
                  title="使えるキーボードショートカットの一覧を表示する"
                  onClick={() => setShowShortcutsModal(true)}
                >
                  ⌨️ ショートカット一覧(?)
                </Button>
              </nav>
            </Flex>

            {/* ショートカットボタンより後ろ(ソースコード上も下)に置く——同じflex行に
                width:100%のメッセージが並ぶと、メッセージの有無でショートカットボタンの
                位置がガタつくため(ユーザー指摘)。 */}
            {dataPanelMessage ? (
              <Text as="p" size="2" data-testid="data-panel-message">
                {dataPanelMessage}
              </Text>
            ) : null}

            {showShortcutsModal ? (
              <ShortcutsModal
                registry={shortcutRegistry}
                onClose={() => setShowShortcutsModal(false)}
              />
            ) : null}

            <div className="app-main">
              <div className="app-sidebar">
                <MiniCalendar />
                <TodoList todos={todos} onTodosChange={updateTodos} />
              </div>
              <section className="app-notes">
                {/* タブバーと全文検索は、下へスクロールしても上端に貼り付いて追従する
                    (position:sticky。ユーザー指示)。2つをまとめて1つのstickyヘッダにする。 */}
                <div className="note-sticky-head" data-testid="note-sticky-head">
                  {/* ノート本文の文字サイズを一括調整する(A-/A+。ノート以外の文字には効かない)。 */}
                  <Flex align="center" gap="2" className="note-font-toolbar">
                    <Text size="1" color="gray">
                      ノート文字サイズ
                    </Text>
                    <Button
                      type="button"
                      variant="soft"
                      size="1"
                      data-testid="note-font-decrease"
                      title="ノート本文の文字を小さくする"
                      onClick={() => changeNoteFontSize(-NOTE_FONT_STEP)}
                    >
                      A−
                    </Button>
                    <Text size="1" data-testid="note-font-size-value">
                      {noteFontSize}px
                    </Text>
                    <Button
                      type="button"
                      variant="soft"
                      size="1"
                      data-testid="note-font-increase"
                      title="ノート本文の文字を大きくする"
                      onClick={() => changeNoteFontSize(NOTE_FONT_STEP)}
                    >
                      A＋
                    </Button>
                    <Button
                      type="button"
                      variant="soft"
                      size="1"
                      data-testid="tag-all-notes"
                      title="全ノートにまとめてGeminiでタグを付ける(前回タグ付け以降に変更のないノートはスキップ)"
                      disabled={tagging}
                      onClick={() => void handleTagAll()}
                    >
                      {tagging ? "タグ付け中…" : "🏷️ まとめてタグをふる"}
                    </Button>
                  </Flex>
                  <Flex align="center" gap="3" wrap="wrap" className="note-manage-bar">
                    <NoteTabs
                      notes={notes}
                      activeNoteId={activeNoteId}
                      visibleNoteIds={visibleNoteIds}
                      onNotesChange={updateNotes}
                      onSelect={selectNote}
                      onToggleVisible={toggleVisible}
                    />
                  </Flex>
                  <Suspense fallback={<div data-testid="search-loading">検索を読み込み中…</div>}>
                    <SearchPanel
                      ref={searchInputRef}
                      notes={notes}
                      onSelectNote={(noteId) => selectNote(noteId)}
                    />
                  </Suspense>
                </div>
                <TagSearchPanel notes={notes} onSelectNote={selectNote} />
                {visibleNotes.length > 0 ? (
                  <div className="note-editor-panes">
                    {visibleNotes.map((note) => (
                      <NoteEditorPane
                        key={note.id}
                        note={note}
                        notes={notes}
                        isActive={note.id === activeNoteId}
                        autoFocus={note.id === activeNoteId && userSelectedNoteRef.current}
                        manualSyncSignal={manualSyncSignal}
                        onNotesChange={updateNotes}
                        onSelectNote={selectNote}
                        onSelectNoteByTitle={selectNoteByTitle}
                        onCreateNote={openFileAsNote}
                        onAddTodos={addTodos}
                        onMessage={setDataPanelMessage}
                      />
                    ))}
                  </div>
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
      </Box>
      {/* 右端に半透明で常駐する「一番上へ/一番下へ」ジャンプ(ユーザー指示。少し大きめ)。 */}
      <div className="scroll-jump">
        <button
          type="button"
          className="scroll-jump-btn"
          data-testid="scroll-to-top"
          title="一番上へ"
          aria-label="一番上へスクロール"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          ↑
        </button>
        <button
          type="button"
          className="scroll-jump-btn"
          data-testid="scroll-to-bottom"
          title="一番下へ"
          aria-label="一番下へスクロール"
          onClick={() =>
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" })
          }
        >
          ↓
        </button>
      </div>
    </Theme>
  );
}
