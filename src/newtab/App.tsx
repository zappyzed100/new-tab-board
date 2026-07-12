// App.tsx — 新しいタブのルートコンポーネント(SPEC.md準拠の再構築中。M3以降で機能を積み上げる)
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Card, Flex, Text, Theme } from "@radix-ui/themes";
import { BookmarkGrid } from "./components/shell/BookmarkGrid";
import { Clock } from "./components/shell/Clock";
import { DataPanel } from "./components/shell/DataPanel";
import { MiniCalendar } from "./components/shell/MiniCalendar";
import { NoteEditorPane } from "./components/notes/NoteEditorPane";
import { LibraryPanel } from "./components/discovery/LibraryPanel";
import { PastedImagesPanel } from "./components/clipboard/PastedImagesPanel";
import { ShortcutsModal } from "./components/discovery/ShortcutsModal";
import { TagSearchPanel } from "./components/discovery/TagSearchPanel";
import { ThemeToggle } from "./components/shell/ThemeToggle";
import { TodoList } from "./components/shell/TodoList";
import { TagCandidatesPanel } from "./components/shell/TagCandidatesPanel";
import { sortedBookmarks } from "../lib/entities/bookmarks";
import { loadLocalData, loadSyncData, saveLocalData, saveSyncData } from "../lib/storage/storage";
import {
  addNote,
  addNoteAfter,
  createNote,
  ensureTrailingEmptyNotes,
  isDefaultNoteTitle,
  pasteResultsIntoNotes,
  moveNoteUp,
  reorderNotesById,
  sortedNotes,
  TRAILING_EMPTY_NOTES,
  updateNote,
} from "../lib/entities/notes";
import { geminiUsageDateKey, getGeminiApiKey, getGeminiUsageCount } from "../lib/storage/db";
import { GEMINI_DAILY_WARN_THRESHOLD } from "../lib/gemini/gemini";
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
import { syncJsonBackupToDrive } from "../lib/drive/jsonBackupSync";
import { getAuthToken } from "../lib/drive/googleAuth";
import { reconcileDriveActive } from "../lib/drive/driveActiveMirror";
import { useGlobalShortcuts } from "../lib/shortcuts/useGlobalShortcuts";
import type { AppLaunch, Bookmark, LocalData, Note, Settings, Todo } from "../types";

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

// 全文検索は「全ノート横断」の性質上、複数ペイン表示でも唯一グローバルのまま
// (プレビュー/履歴/エディタ本体はNoteEditorPane側でペインごとに動的import)。
const SearchPanel = lazy(() =>
  import("./components/discovery/SearchPanel").then((m) => ({ default: m.SearchPanel })),
);

// ノートボードの列数(1列あたり概ね280px、最大3列)。列固定masonryの振り分けに使う。
function noteColumnCountFor(width: number): number {
  return Math.max(1, Math.min(3, Math.floor(width / 280)));
}

export function App() {
  const [sync, setSync] = useState<SyncState | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  // 全文検索バーは常時表示(開閉トグルは撤去済み——ユーザー指示)。Cmd/Ctrl+Fは
  // この検索欄へフォーカスを移す操作として再割り当てする(下のsearchInputRef参照)。
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  // 「📁 ライブラリ」(NASの階層md保管庫)の開閉。作業ノートとは別レーンのため既定は閉じる。
  const [showLibrary, setShowLibrary] = useState(false);
  // 本日のGemini使用回数(450到達でGPT-OSS 120Bへの乗り換え警告を出す——ユーザー指示)。
  const [geminiUsageToday, setGeminiUsageToday] = useState(0);
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
  // ドラッグ交換で「掴んでいるノートid」を保持するref(同期更新——下記handleNoteDragStart参照)。
  const dragNoteIdRef = useRef<string | null>(null);
  function selectNote(noteId: string) {
    // 全件表示なので「表示集合に入れる」処理は不要。アクティブ(オートフォーカス対象)を移すだけ。
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

  // 常に末尾へ空ノートを3つ確保する(ユーザー指示: 付箋を貼るための余白。スプレッドシートの
  // 末尾空行と同じ発想)。ensureTrailingEmptyNotesは不足時のみ新しい配列を返すため冪等——
  // 補充が必要な時だけ更新し、無限ループにならない(補充後は trailing=3 で同一参照が返る)。
  useEffect(() => {
    if (!notes) return;
    if (ensureTrailingEmptyNotes(notes, TRAILING_EMPTY_NOTES, clockNow()) !== notes) {
      updateNotes((prev) => ensureTrailingEmptyNotes(prev, TRAILING_EMPTY_NOTES, clockNow()));
    }
  }, [notes]);

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

  // Google Drive の app/New Tab Board/active/ を「編集中のノート一覧」に突き合わせる(ユーザー指示)。
  // 空でないノートの本文アップロードは各ペインのuseDriveSyncが行い、ここでは①消された/空になった
  // ノートのファイルを削除②日付フォルダへその日のコピーを格納する。Drive未接続(トークン無し)なら
  // 静かに何もしない。debounceして編集の嵐で叩きすぎないようにする。
  useEffect(() => {
    if (!notes) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const token = await getAuthToken(false); // 非対話——未接続ならnullで静かに終わる
          if (!token) return;
          await reconcileDriveActive(notes, clockNow(), token);
        } catch {
          // Drive同期の突合失敗はUIを止めない(次の編集で再試行される)。
        }
      })();
    }, 5000);
    return () => clearTimeout(timer);
  }, [notes]);

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

  // 本日のGemini使用回数を読み、しきい値(450)到達で警告バナーを出す。自動タグ付け等で
  // 回数が増えるため、起動時と30秒ごとに読み直す(日跨ぎはgeminiUsageDateKeyで数え直される)。
  const refreshGeminiUsage = () =>
    void getGeminiUsageCount(geminiUsageDateKey(clockNow())).then(setGeminiUsageToday);
  useEffect(() => {
    refreshGeminiUsage();
    const interval = setInterval(refreshGeminiUsage, 30_000);
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
  // タグ候補(TODOリスト下で管理・LLMのタグ推定へ渡す優先候補)。設定にsync/バックアップされる。
  const tagCandidates = sync?.settings.tagCandidates ?? [];
  // ノートボードの列数を画面幅から決める(概ね1列280px。最大3列)。列固定masonryでは
  // ノートを order 順に i%列数 で各列へ振り分けるため、列数はJSで知っている必要がある。
  const [columnCount, setColumnCount] = useState(() => noteColumnCountFor(window.innerWidth));
  useEffect(() => {
    const onResize = () => setColumnCount(noteColumnCountFor(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // order 順の全ノートを i%列数 で各列へ振り分ける(左上めがけて詰める。短いノートの真下に
  // 次のノートが詰まり、削除で全員がひとつ左上へ寄る——ユーザー指示の「列固定・安定」)。
  const noteColumns = useMemo(() => {
    const cols: Note[][] = Array.from({ length: columnCount }, () => []);
    orderedNotes.forEach((note, i) => cols[i % columnCount].push(note));
    return cols;
  }, [orderedNotes, columnCount]);

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

  // ノートボードの並べ替え/ピン(すべてlinear order=sortedNotes上の操作。列固定masonryの
  // 見た目はApp側の振り分けが追従する)。
  function togglePinNote(noteId: string) {
    updateNotes((prev) => {
      const target = prev.find((n) => n.id === noteId);
      return updateNote(prev, noteId, { pinned: !target?.pinned });
    });
  }
  function moveNoteUpOne(noteId: string) {
    updateNotes((prev) => moveNoteUp(prev, noteId));
  }
  // ペインをまたぐドラッグ交換: 掴んだノートidをrefに置き(refは同期更新なので再レンダ待ちに
  // 依存しない)、別ペインへdropしたらその位置へ移動する。DataTransferは使わない
  // (合成DnDテスト環境ではペイン間でDataTransferが運ばれないため、refで確実に受け渡す)。
  function handleNoteDragStart(noteId: string) {
    dragNoteIdRef.current = noteId;
  }
  function handleNoteDrop(targetId: string) {
    const fromId = dragNoteIdRef.current;
    dragNoteIdRef.current = null;
    if (fromId && fromId !== targetId) {
      updateNotes((prev) => reorderNotesById(prev, fromId, targetId));
    }
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
      const { tags, junk, title } = await analyzeNote(note.content, apiKey, {}, tagCandidates);
      if (tags.length > 0 || junk || title) {
        const hash = contentHash(note.content);
        // 一括では既定タイトル(ノートX)のときだけ生成タイトルを入れる(手動命名は尊重)。
        const setTitle = title !== "" && isDefaultNoteTitle(note.title);
        updateNotes((prev) =>
          updateNote(prev, note.id, {
            tags,
            junk,
            taggedHash: hash,
            ...(setTitle ? { title } : {}),
          }),
        );
        done += 1;
        if (junk) junkCount += 1;
      }
    }
    setTagging(false);
    setDataPanelMessage(
      `タグ付け完了: ${done}件に付与(未変更でスキップ${all.length - targets.length}件` +
        `${junkCount > 0 ? `・ゴミ判定${junkCount}件はNAS保管対象外` : ""})`,
    );
    refreshGeminiUsage(); // 大量のGemini呼び出し直後は使用量を即時に反映する(警告の出遅れ防止)。
  }

  // 「☁️ Driveへ退避」: 自動同期を待たず、現在の全データを今すぐDriveへ書き出す(退避の即時版)。
  async function handleBackupToDrive() {
    if (!backupJson) return;
    setDataPanelMessage("Google Driveへ退避中…");
    const result = await syncJsonBackupToDrive(
      backupJson,
      clockNow(),
      true,
      sync?.settings.jsonBackupFileId,
    );
    if (result.status === "synced") {
      updateSettings({ jsonBackupFileId: result.fileId });
      setDataPanelMessage("Google Driveへ退避しました(以後の変更は自動でも同期されます)");
    } else if (result.status === "unauthenticated") {
      setDataPanelMessage(
        "Googleアカウントにログインできませんでした(⚙️ GDrive設定から接続してください)",
      );
    } else {
      setDataPanelMessage("Driveへの退避に失敗しました");
    }
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
    const full = { ...note, content, ...meta };
    // 要約(sourceNoteId付き)は元ノートの直後へ挿入する=列固定masonryで「一つ右(右端なら
    // 一段下の一番左)」に現れる(ユーザー指示)。それ以外(ファイル取り込み等)は末尾へ。
    updateNotes((prev) =>
      meta?.sourceNoteId ? addNoteAfter(prev, full, meta.sourceNoteId) : addNote(prev, full),
    );
    selectNote(note.id);
  }

  // NAS検索結果をノート末尾へ貼り付ける(白紙ノートは上書き。ユーザー指示)。
  function pasteSearchResults(results: { title: string; content: string }[]) {
    if (results.length === 0) return;
    updateNotes((prev) => pasteResultsIntoNotes(prev, results, clockNow()));
    setDataPanelMessage(`検索結果 ${results.length}件をノートへ貼り付けました`);
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
            {geminiUsageToday >= GEMINI_DAILY_WARN_THRESHOLD ? (
              <Card data-testid="gemini-usage-warning">
                <Text size="3" weight="medium" color="orange">
                  ⚠️ 本日のGemini使用が{geminiUsageToday}回に達しました(しきい値
                  {GEMINI_DAILY_WARN_THRESHOLD})。無料枠を使い切る前に、GPT-OSS 120Bへの乗り換えを
                  検討してください。
                </Text>
              </Card>
            ) : null}
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
                  onBackupToDrive={() => void handleBackupToDrive()}
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
                <TagCandidatesPanel
                  candidates={tagCandidates}
                  onCandidatesChange={(next) => updateSettings({ tagCandidates: next })}
                />
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
                    <Button
                      type="button"
                      variant={showLibrary ? "solid" : "soft"}
                      size="1"
                      data-testid="toggle-library"
                      title="NASの階層md保管庫(ライブラリ)を開閉する(作業ノートとは別レーン)"
                      onClick={() => setShowLibrary((v) => !v)}
                    >
                      📁 ライブラリ
                    </Button>
                  </Flex>
                  <Suspense fallback={<div data-testid="search-loading">検索を読み込み中…</div>}>
                    <SearchPanel
                      ref={searchInputRef}
                      notes={notes}
                      onSelectNote={(noteId) => selectNote(noteId)}
                    />
                  </Suspense>
                </div>
                <TagSearchPanel
                  notes={notes}
                  onSelectNote={selectNote}
                  onPasteResults={pasteSearchResults}
                />
                {showLibrary ? <LibraryPanel /> : null}
                {orderedNotes.length > 0 ? (
                  // 列固定masonry: order順の全ノートを i%列数 で各列へ振り分けて縦積みする
                  // (短いノートの真下に次が詰まり、長いノートで隣が伸びない——ユーザー指示)。
                  <div className="note-board" data-testid="note-board">
                    {noteColumns.map((column, colIndex) => (
                      <div
                        key={colIndex}
                        className="note-column"
                        data-testid={`note-column-${colIndex}`}
                      >
                        {column.map((note) => (
                          <NoteEditorPane
                            key={note.id}
                            note={note}
                            notes={notes}
                            tagCandidates={tagCandidates}
                            isActive={note.id === activeNoteId}
                            isFirst={orderedNotes[0]?.id === note.id}
                            autoFocus={note.id === activeNoteId && userSelectedNoteRef.current}
                            manualSyncSignal={manualSyncSignal}
                            onNotesChange={updateNotes}
                            onSelectNote={selectNote}
                            onSelectNoteByTitle={selectNoteByTitle}
                            onCreateNote={openFileAsNote}
                            onAddTodos={addTodos}
                            onMessage={setDataPanelMessage}
                            onTogglePin={togglePinNote}
                            onMoveUp={moveNoteUpOne}
                            onDragStartNote={handleNoteDragStart}
                            onDropNote={handleNoteDrop}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Card data-testid="no-notes">
                    <Text size="3" weight="medium" color="indigo">
                      📝 ノートがありません。上の「+ ノート」ボタンを押すと書き始められます
                    </Text>
                  </Card>
                )}
                {/* ノート類の下に一つ線を引いて、貼り付けた画像の一覧を置く(ユーザー指示)。 */}
                <hr className="notes-images-divider" />
                <PastedImagesPanel />
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
