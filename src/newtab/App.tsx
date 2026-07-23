// App.tsx — 新しいタブのルートコンポーネント(SPEC.md準拠の再構築中。M3以降で機能を積み上げる)
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Box, Button, Card, Flex, Text, Theme } from "@radix-ui/themes";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp as ArrowUpIcon,
  BatteryWarning,
  BellOff,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Keyboard,
  Search,
  StickyNote,
  Tag,
  Wrench,
} from "lucide-react";
import { useForegroundSync } from "./useForegroundSync";
import { BookmarkGrid } from "./components/shell/BookmarkGrid";
import { Clock } from "./components/shell/Clock";
import { DataPanel } from "./components/shell/DataPanel";
import { MiniCalendar } from "./components/shell/MiniCalendar";
import { NoteEditorPane } from "./components/notes/NoteEditorPane";
import { useNoteImages } from "../lib/images/useNoteImages";
import { markdownImageReference } from "../lib/images/noteImages";
import { EditingSeamProvider, useEditingSeam } from "./components/notes/editing-seam";
import { ViewportNote } from "./components/board/ViewportNote";
import { ShortcutsModal } from "./components/discovery/ShortcutsModal";
import { TagSearchPanel } from "./components/discovery/TagSearchPanel";
import { ThemeToggle } from "./components/shell/ThemeToggle";
import { TodoList } from "./components/shell/TodoList";
import { TagCandidatesPanel } from "./components/shell/TagCandidatesPanel";
import { sortedBookmarks } from "../lib/entities/bookmarks";
import {
  loadLocalData,
  loadSyncData,
  patchLocalData,
  saveSyncData,
  subscribeLocalData,
  updateLocalData,
} from "../lib/storage/storage";
import {
  mergeNoteCollections,
  preserveProtectedNotes,
  stampChangedNotes,
  updateTombstonesForMutation,
  type NoteTombstones,
} from "../lib/storage/note-sync";
import {
  commitMergedNotes,
  commitNoteMutation,
  initializeLocalData,
} from "../lib/storage/local-data-repository";
import {
  addNote,
  addNoteAfter,
  createNote,
  ensureTrailingEmptyNotes,
  excludeNoSyncNotes,
  isDefaultNoteTitle,
  nextNoteOrder,
  pasteResultsIntoNotes,
  moveNoteDown,
  moveNoteUp,
  removeNote,
  reorderNotesById,
  sortedNotes,
  TRAILING_EMPTY_NOTES,
  updateNote,
} from "../lib/entities/notes";
import {
  freezeNoteToSpecial,
  removeSpecialItem,
  specialEntries,
  specialSyncSignature,
  toggleNoteSpecial,
  upsertSpecialItem,
} from "../lib/entities/special";
import { pushSpecialToNas } from "../lib/externalIO/specialSync";
import {
  pullSettingsBackupFromNas,
  pushSettingsBackupToNas,
} from "../lib/externalIO/settingsBackupSync";
import { buildSettingsBackupPayload, serializeSettingsBackup } from "../lib/fileio/settingsBackup";
import { geminiUsageDateKey, getGeminiApiKey, getGeminiUsageCount } from "../lib/storage/db";
import { GEMINI_DAILY_WARN_THRESHOLD } from "../lib/gemini/gemini";
import { analyzeNote, contentHash, needsRetag } from "../lib/gemini/tagging";
import { buildTagVocabulary } from "../lib/entities/tags";
import { buildExportPayload, serializeExport } from "../lib/fileio/exportImport";
import {
  buildBookmarkJumpShortcuts,
  buildNoteJumpShortcuts,
  SHORTCUT_REGISTRY,
} from "../lib/shortcuts/shortcuts";
import { replaceInNotes } from "../lib/search/noteSearch";
import { resolveTheme } from "../lib/display/theme";
import { clampNoteFontSize, NOTE_FONT_DEFAULT, NOTE_FONT_STEP } from "../lib/display/noteFont";
import { now as clockNow } from "../lib/runtime/clock";
import { logOp } from "../lib/runtime/log";
import { computeCountdown, formatCountdown } from "../lib/nextEvent/nextEventCountdown";
import {
  flushAllToNas,
  todosToMarkdown,
  writeTodosToNasActive,
} from "../lib/externalIO/nasArchive";
import {
  claimNasOwnership,
  decideActiveSync,
  pullActiveFromNas,
  pushActiveToNas,
  resolveSecondaryAction,
} from "../lib/externalIO/nasActiveSync";
import { readNasGeneration } from "../lib/externalIO/nasNativeHost";
import { getNasFolderPath } from "../lib/storage/db";
import { pullPendingFile } from "../lib/externalIO/nativeMessaging";
import { useJsonBackupSync } from "../lib/drive/useJsonBackupSync";
import { syncJsonBackupToDrive } from "../lib/drive/jsonBackupSync";
import { getAuthToken } from "../lib/drive/googleAuth";
import { syncDriveNotesSafely } from "../lib/drive/driveSafeSync";
import { copyNotesToDriveDateFolder, pushTodosToDriveActive } from "../lib/drive/driveActiveMirror";
import { pushSpecialToDrive } from "../lib/drive/driveSpecial";
import { useGlobalShortcuts } from "../lib/shortcuts/useGlobalShortcuts";
import { forceSnapshot } from "../lib/history/useSnapshotScheduler";
import type { AppLaunch, Bookmark, LocalData, Note, Settings, SpecialItem, Todo } from "../types";
import { SpecialPanel } from "./components/shell/SpecialPanel";

type SyncState = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };

// 全文検索は「全ノート横断」の性質上、複数ペイン表示でも唯一グローバルのまま
// (プレビュー/履歴/エディタ本体はNoteEditorPane側でペインごとに動的import)。
const SearchPanel = lazy(() =>
  import("./components/discovery/SearchPanel").then((m) => ({ default: m.SearchPanel })),
);

// タブ↔NAS active の世代同期の間隔(ユーザー指示: activeで5分毎に最新データと連携)。
const NAS_SYNC_INTERVAL_MS = 300_000;

// タブが前景に戻った時の同期の最小間隔(ユーザー指示・2026-07-20: タブ新規作成時・タブ操作時に
// Driveからactiveを取得したい)。visibilitychangeとfocusは同時に来ることがあり、タブを行き来
// するだけでDrive APIを連打しかねないため、この間隔でまとめて1回に落とす。
const FOREGROUND_SYNC_MIN_INTERVAL_MS = 30_000;

// ノートボードの列数(1列あたり概ね280px、最大3列)。実測masonryの振り分けに使う。
function noteColumnCountFor(width: number): number {
  return Math.max(1, Math.min(3, Math.floor(width / 280)));
}

export function App() {
  const [sync, setSync] = useState<SyncState | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  // スペシャル(⭐)の凍結項目とフォルダ一覧(localDataに永続化。ユーザー指示)。
  const [specialItems, setSpecialItems] = useState<SpecialItem[]>([]);
  const [specialFolders, setSpecialFolders] = useState<string[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  // 全文検索欄への参照(Cmd/Ctrl+Fでこの欄へフォーカスを移す)。
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  // データ操作パネル(ファイルを開く/Drive・NAS操作等)・全文検索・NAS検索は、
  // 新規タブを開くたびに折りたたんだ状態から始める(ユーザー指示:「一目でノート内容が
  // 見えるように」)。セッションを跨いだ記憶はしない(開けば毎回また閉じた状態に戻る)。
  // 全文検索・NAS検索は元々常時表示だったが、これも普段使わず高さだけ食うとの指摘で
  // 同じ折りたたみ式へ揃えた(2026-07-18)。
  const [showDataPanel, setShowDataPanel] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [showTagSearchPanel, setShowTagSearchPanel] = useState(false);
  // 本日のGemini使用回数(450到達でGPT-OSS 120Bへの乗り換え警告を出す——ユーザー指示)。
  const [geminiUsageToday, setGeminiUsageToday] = useState(0);
  // DataPanelの結果メッセージはここで持つ(DataPanel内で持つと、隣接する
  // 「ショートカット一覧」ボタンと同じflexコンテナに並ぶwidth:100%のメッセージが
  // メッセージの有無でショートカットボタンの位置をガタつかせるため、ソースコード上も
  // ショートカットボタンより後ろに置く——ユーザー指摘)。
  const [dataPanelMessage, setDataPanelMessage] = useState<string | null>(null);
  // Drive接続状態(null=未判定)。Drive連携の失敗は全経路が「トークンが無ければ静かに何もしない」
  // 設計のため完全に無症状で、2026-07-18〜20には丸2日間まるごと停止していたのに誰も気づけな
  // かった(googleAuth.tsのヘッダー参照)。**折りたたみ式のDataPanel内に置くと、開くまで警告が
  // 出ず早期警告にならない**ため、Appが持ってヘッダー(常時表示)へ出す。
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [nextEventCache, setNextEventCache] = useState<LocalData["nextEventCache"]>(undefined);
  const [alarmActive, setAlarmActive] = useState(false);
  // スマホのバッテリー低下警告(GAS Web App中継)が鳴動中か(ユーザー指示: New Tab Boardに
  // 警告を出したい)。予定前アラームと同じ「停止」ボタンパターンで表示する。
  const [batteryAlarmActive, setBatteryAlarmActive] = useState(false);
  // resolveTheme()の解決結果("light"/"dark"。"auto"はメディアクエリで解決済みの値)を
  // document.documentElement.dataset.themeへの書き込みと同時にstateへも保持し、
  // Radixの<Theme appearance>propへ同じ値を配線する(二重の解決ロジックを作らない)。
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  // Cmd/Ctrl+Sで「見えている全ペイン」に即時スナップショット+Drive同期をキックする
  // ための共有シグナル(各NoteEditorPaneがこの値の変化をuseEffectで監視する)。
  const [manualSyncSignal, setManualSyncSignal] = useState(0);
  // Cmd/Ctrl+Rで全文検索の置換欄を開く共有シグナル(manualSyncSignalと同じ発想。ユーザー指示:
  // 既存の全文検索を拡張して置換もできるように)。
  const [replaceSignal, setReplaceSignal] = useState(0);
  // 置換実行のたびに増える共有カウンタ。Notepad(CM6)はcontentをマウント時にしか読まないため、
  // 置換で本文を外部から書き換えた後、既に開いているエディタへ反映するには再マウントが要る
  // (NoteEditorPane.tsxのrestoreCounterと同じ理由)。
  const [replaceContentVersion, setReplaceContentVersion] = useState(0);
  // 別タブ同期で本文が実際に変わったノートだけを再マウントする版数。全ペイン共通の版数を
  // 進めると、別タブの空ノート補充や並び変更だけでも入力中のCM6が破棄されて文字が脱落する。
  const [syncedContentVersions, setSyncedContentVersions] = useState<Record<string, number>>({});
  // 「🏷️ タグをふる」実行中フラグ(二重起動防止・ラベル切替)。
  const [tagging, setTagging] = useState(false);
  // 初回表示時はオムニバーへフォーカスしたい(検索にすぐ入れる新規タブらしい挙動)ので、
  // 「ユーザーが自分でノートを選んだ」時だけノート本文へオートフォーカスする
  // (それ以外=起動直後の自動選択ではフォーカスを奪わない)。
  const userSelectedNoteRef = useRef(false);
  // ドラッグ交換で「掴んでいるノートid」を保持するref(同期更新——下記handleNoteDragStart参照)。
  const dragNoteIdRef = useRef<string | null>(null);
  // タブ↔NAS active の世代同期(ユーザー指示)。nasGenRef=このタブが同期済みの世代、
  // nasOwnerRef=このセッションが操作開始時にbumpして所有権を得たか。notesRefは同期tickが最新の
  // ノートを読むための鏡(effectの依存を増やさずに現在値を参照する)。
  const nasGenRef = useRef(0);
  const nasOwnerRef = useRef(false);
  const noteTombstonesRef = useRef<NoteTombstones>({});
  const storageRevisionRef = useRef(0);
  const notesRef = useRef<Note[] | null>(null);
  notesRef.current = notes;
  // 同期tick/購読(マウント時クロージャ)が「今ユーザーが選んで編集中のノートid」を読むための鏡。
  // これを preserveProtectedNote へ渡し、起動直後に選んだノートを同期処理が動かす/消すのを防ぐ。
  const activeNoteIdRef = useRef<string | null>(null);
  activeNoteIdRef.current = activeNoteId;
  // 編集中ノートの単一の真実源(ドラフトバッファ＋編集レジストリ)。同期tick/購読/コミット往復が
  // 「今フォーカス中/未保存のノート全部」を読んで不可侵にするための ref を持つ(editing-seam.tsx)。
  // seam は Provider で子(NoteEditorPane)へ配り、ref はここで直読みする。
  const { seam: editingSeam, refs: editingRefs } = useEditingSeam();
  // ノート添付画像の揮発キャッシュ。起動時にNASから読み、以後はメモリ上のobject URLで描画する
  // (画像はNASにだけ置き、chrome.storage.localの10MBクォータには一切載せない — ユーザー指示)。
  const noteImages = useNoteImages();
  const { draftContentRef, editingIdsRef } = editingRefs;
  // 同期tick(マウント時のクロージャで動く)が最新のスペシャル凍結項目を読むための鏡。
  const specialItemsRef = useRef<SpecialItem[]>([]);
  specialItemsRef.current = specialItems;
  // 同期tickがTODO/スペシャルフォルダ/ブックマーク・設定の現在値を読むための鏡(ユーザー指示:
  // これらもNASへ保存する。特にTODOリストはactiveの同期サイクルに乗せてほしい)。
  const todosRef = useRef<Todo[]>([]);
  todosRef.current = todos;
  const specialFoldersRef = useRef<string[]>([]);
  specialFoldersRef.current = specialFolders;
  const syncRef = useRef<SyncState | null>(null);
  syncRef.current = sync;
  // NASへ最後に保存した各ノートのフィンガープリント(id→ハッシュ)。同じなら再保存しない。
  const nasSavedHashesRef = useRef<Record<string, string>>({});
  // NAS special(⭐)の直近pushシグネチャ(driveSpecialSigRefと同じ発想)。pushSpecialToNasは
  // 全件突き合わせ書き込みでハッシュ差分を持たないため、これが無いと5分毎のpushのたびに
  // 内容不変でも⭐全件がNASへ無駄に再書き込みされていた(2026-07-16 是正)。
  const nasSpecialSigRef = useRef<string>("");
  // NAS設定バックアップ(テーマ/TODO/ブックマーク/ノート文字サイズ/スペシャル/タグ候補)の
  // 直近保存ハッシュ。内容不変のtickで無駄に再書き込みしない(nasSpecialSigRefと同じ発想)。
  const nasSettingsSigRef = useRef<string>("");
  // TODOをactive/todos.txtへも書く(ユーザー指示: 「二重管理でもいい」ので既存のsettings
  // backupとは別に、NAS/Drive両方のactive/へも直近保存ハッシュ付きで書く)。
  const nasTodosSigRef = useRef<string>("");
  const driveTodosSigRef = useRef<string>("");
  function selectNote(noteId: string) {
    // 全件表示なので「表示集合に入れる」処理は不要。アクティブ(オートフォーカス対象)を移すだけ。
    logOp(
      "notes",
      "select",
      `note=${noteId.slice(0, 8)} prevActive=${activeNoteIdRef.current?.slice(0, 8)}`,
    );
    userSelectedNoteRef.current = true;
    setActiveNoteId(noteId);
  }

  /** 同期の再適用(pull/マージ/購読/コミット往復)から守るべき「編集中ノートid」の集合。
   * 中核は editingIdsRef(フォーカス中=編集中のノート全部。本文ペインをクリックしただけの
   * 非選択ノートも含む)。加えて、起動直後にユーザーが選んだ1件は(フォーカス前でも)従来どおり
   * 守る——同期がその選択を奪うのを防ぐため。起動時の自動選択(notes[0])は含めない。 */
  function protectedNoteIds(): Set<string> {
    const ids = new Set(editingIdsRef.current);
    if (userSelectedNoteRef.current && activeNoteIdRef.current) {
      ids.add(activeNoteIdRef.current);
    }
    return ids;
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSyncData(), initializeLocalData(clockNow())]).then(([syncData, localData]) => {
      if (cancelled) return;
      logOp(
        "notes",
        "boot",
        `notes=${localData.notes.length} rev=${localData.storageRevision ?? 0} ` +
          `active[0]=${localData.notes[0]?.id?.slice(0, 8) ?? "none"}`,
      );
      setSync(syncData);
      setNotes(localData.notes);
      setTodos(localData.todos ?? []);
      setActiveNoteId(localData.notes[0]?.id ?? null);
      setNextEventCache(localData.nextEventCache);
      setAlarmActive(localData.alarmActive ?? false);
      setBatteryAlarmActive(localData.batteryAlarmActive ?? false);
      nasGenRef.current = localData.nasGeneration ?? 0; // 前回同期した世代を引き継ぐ
      noteTombstonesRef.current = localData.noteTombstones ?? {};
      storageRevisionRef.current = localData.storageRevision ?? 0;
      nasSavedHashesRef.current = localData.nasSavedHashes ?? {};
      setSpecialItems(localData.specialItems ?? []);
      setSpecialFolders(localData.specialFolders ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // repositoryが確定したrevisionを画面へ反映するだけの読み取り専用購読。
  // 以前はここで再マージしてsaveLocalDataし、複数タブが互いの通知へ書き返すループを作っていた。
  useEffect(() => {
    return subscribeLocalData((incoming) => {
      if (!notesRef.current) return;
      const revision = incoming.storageRevision ?? 0;
      if (revision < storageRevisionRef.current) {
        logOp(
          "notes-sub",
          "skip-stale-revision",
          `incoming=${revision} have=${storageRevisionRef.current}`,
        );
        return;
      }
      storageRevisionRef.current = revision;
      const currentNotes = notesRef.current;
      // 別タブの確定revisionでも、こちらで編集中のノート(フォーカス中/未保存の全部)は
      // 動かさない/消さない/上書きしない——protectedNoteIds() の集合を local 版で不可侵にする。
      const protectedIds = protectedNoteIds();
      const next = preserveProtectedNotes(
        incoming.notes ?? [],
        currentNotes,
        protectedIds,
        incoming.noteTombstones ?? {},
      );
      noteTombstonesRef.current = incoming.noteTombstones ?? {};
      const notesChanged = JSON.stringify(next) !== JSON.stringify(currentNotes);
      if (notesChanged) {
        setNotes(next);
        // CM6は初期contentをマウント時にだけ読む。ただし全ペインを再マウントすると、本文と
        // 無関係な空ノートIDの収束通知でも入力中エディタを破棄するため、本文差分のあるIDだけ進める。
        // 編集中(protectedIds)のノートは絶対に再マウントしない——ドラフトバッファが本文を保持して
        // いても、再マウントはカーソル/選択/undo履歴を捨てるため、版数自体を進めない。
        const currentContent = new Map(currentNotes.map((note) => [note.id, note.content]));
        const changedContentIds = next
          .filter(
            (note) =>
              !protectedIds.has(note.id) &&
              currentContent.has(note.id) &&
              currentContent.get(note.id) !== note.content,
          )
          .map((note) => note.id);
        // 入力中(protected)ノートが本文差分に入ると、その key が進んでエディタが再マウントされ
        // カーソルが飛ぶ実害の直接原因。上のフィルタで除外済みだが、破れたら即分かるよう出す。
        const remountsActive = changedContentIds.some((id) => protectedIds.has(id));
        const protectedLabel = [...protectedIds].map((id) => id.slice(0, 8)).join(",") || "none";
        logOp(
          "notes-sub",
          "apply",
          `rev=${revision} cur=${currentNotes.length} next=${next.length} ` +
            `protected=${protectedLabel} ` +
            `remountIds=${changedContentIds.length}[${changedContentIds.map((id) => id.slice(0, 8)).join(",")}] ` +
            `REMOUNTS_ACTIVE=${remountsActive}`,
        );
        if (changedContentIds.length > 0) {
          setSyncedContentVersions((versions) => {
            const updated = { ...versions };
            for (const id of changedContentIds) updated[id] = (updated[id] ?? 0) + 1;
            return updated;
          });
        }
        setActiveNoteId((cur) =>
          cur && next.some((note) => note.id === cur) ? cur : (next[0]?.id ?? null),
        );
      } else {
        logOp("notes-sub", "apply-noop", `rev=${revision} notes=${next.length} (no note change)`);
      }
      setTodos(incoming.todos ?? []);
      setNextEventCache(incoming.nextEventCache);
      setAlarmActive(incoming.alarmActive ?? false);
      setBatteryAlarmActive(incoming.batteryAlarmActive ?? false);
      setSpecialItems(incoming.specialItems ?? []);
      setSpecialFolders(incoming.specialFolders ?? []);
    });
  }, []);

  // 新規タブページが開いたタイミングでNASフォルダの権限確認→有効なうちにフラッシュを
  // 試行する(SPEC.md §4.3。File System Accessはservice workerでは使えないためnew-tab
  // 文脈でのみ実行できる。NAS未設定/権限無し/到達不可はnasArchive.ts側で静かに0件扱い)。
  useEffect(() => {
    void flushAllToNas();
  }, []);

  // タブ↔NAS active の世代同期(ユーザー指示)。世代を突き合わせ、自分が所有者で同世代なら push
  // (active上書き+日付追記+削除突合)、NASが新しければ pull(NAS activeでノートを丸ごと上書き。
  // 最終操作者優先)。NAS未設定/未接続は静かにスキップ。全refで現在値を読むので依存は不要。
  function applyPulledNotes(pulled: Note[]) {
    // NAS側も不在だけでは削除と判断せず、ローカルとの和集合にする。削除は共通tombstoneだけ。
    const merged = mergeNoteCollections(notesRef.current ?? [], pulled, noteTombstonesRef.current);
    logOp(
      "notes-pull",
      "apply-pulled",
      `local=${(notesRef.current ?? []).length} pulled=${pulled.length} merged=${merged.notes.length}`,
    );
    applySafelySyncedNotes(merged.notes, merged.tombstones);
  }

  function applySafelySyncedNotes(notesFromSync: Note[], tombstones: NoteTombstones) {
    // 編集中(フォーカス中/未保存)のノートは、同期結果に動かされ/消され/上書きされないよう最優先で守る。
    // ただし明示削除(tombstone)は編集保護より優先する(preserveProtectedNotes 参照)。
    const guarded = preserveProtectedNotes(
      notesFromSync,
      notesRef.current ?? [],
      protectedNoteIds(),
      tombstones,
    );
    const next = ensureTrailingEmptyNotes(guarded, TRAILING_EMPTY_NOTES, clockNow());
    logOp(
      "notes-pull",
      "apply-synced",
      `fromSync=${notesFromSync.length} guarded=${guarded.length} ` +
        `final=${next.length} protected=${[...protectedNoteIds()].length}`,
    );
    noteTombstonesRef.current = tombstones;
    setNotes(next);
    setActiveNoteId((cur) => (cur && next.some((n) => n.id === cur) ? cur : (next[0]?.id ?? null)));
    void commitMergedNotes(next, tombstones);
  }
  // NASへの「push」本体(世代同期tickのpush分岐と、「今すぐNASへ書き出し」ボタンの両方から
  // 呼ぶ共通処理——ユーザー指示: ボタンでも即座にactive/日付フォルダへ反映してほしい)。
  // ハッシュで保存済みか判定して変わったノートだけ書く・消えたノートはpushActiveToNas内部の
  // reconcileActiveNotesOnNasが削除する(いずれもユーザー指示: 無駄な再保存を避ける/古い
  // ファイルを消す)。
  async function pushNasActiveNow(): Promise<void> {
    // 書き込み前に、空でない全ノートへGeminiをかけてタグを最新化する(ユーザー指示: NASへの
    // 書き込みが実行される前にタグ付けを済ませてほしい)。tagAllNotesがupdateNotesで
    // notesRefを更新済みなので、直後のnotesRef.current読み取りは新しいタグを反映する。
    await tagAllNotes();
    const current = notesRef.current ?? [];
    const r = await pushActiveToNas(current, clockNow(), nasSavedHashesRef.current);
    nasSavedHashesRef.current = r.savedHashes;
    await patchLocalData({ nasSavedHashes: r.savedHashes });
    // スペシャル(⭐)は NAS の special/<folder>/<id>.md へ(ユーザー指示)。live+frozenを突き合わせ。
    // pushSpecialToNas自体はハッシュ差分を持たない全件書き込みのため、ここでシグネチャが
    // 変わった時だけ呼ぶ(内容不変のtickで⭐全件を無駄に再書き込みしない——2026-07-16 是正)。
    // 「この端末のみ(noSync)」の live ノート・凍結項目は special ミラーにも出さない。
    const specialEntriesNow = specialEntries(
      excludeNoSyncNotes(current),
      specialItemsRef.current.filter((i) => !i.noSync),
    );
    const specialSig = specialSyncSignature(specialEntriesNow);
    if (specialSig !== nasSpecialSigRef.current) {
      await pushSpecialToNas(specialEntriesNow);
      nasSpecialSigRef.current = specialSig;
    }
    // 設定バックアップ(テーマ/TODO/ブックマーク/ノート文字サイズ/スペシャル/タグ候補)も
    // activeと同じタイミングでNASへ書く(ユーザー指示: 特にTODOリストはactiveの同期サイクルに
    // 乗せてほしい)。notesは含めない(active/日付フォルダで既に別途同期されているため)。
    if (syncRef.current) {
      const settingsJson = serializeSettingsBackup(
        buildSettingsBackupPayload(
          syncRef.current,
          {
            todos: todosRef.current,
            // 「この端末のみ」の凍結項目は設定バックアップ(NAS)にも含めない。
            specialItems: specialItemsRef.current.filter((i) => !i.noSync),
            specialFolders: specialFoldersRef.current,
          },
          clockNow(),
        ),
      );
      const settingsHash = contentHash(settingsJson);
      if (settingsHash !== nasSettingsSigRef.current) {
        if (await pushSettingsBackupToNas(settingsJson)) {
          nasSettingsSigRef.current = settingsHash;
        }
      }
    }
    // TODOはactive/todos.txtへも書く(ユーザー指示: 「二重管理でもいい」ので設定バックアップとは
    // 別にactive/へ直接反映する)。
    const todosMd = todosToMarkdown(todosRef.current);
    const todosSig = contentHash(todosMd);
    if (todosSig !== nasTodosSigRef.current) {
      if (await writeTodosToNasActive(todosRef.current)) {
        nasTodosSigRef.current = todosSig;
      }
    }
  }

  /** NAS側の世代同期tick。**二次側**なので、Driveが正本として機能した回はpullを抑止する
   * (規則の本体と根拠は resolveSecondaryAction)。 */
  async function runNasSyncTick(driveAuthoritative: boolean): Promise<void> {
    const path = await getNasFolderPath();
    if (!path) return; // NAS未設定なら同期しない
    const nasGen = await readNasGeneration(path);
    if (nasGen === null) return; // 未接続/失敗は静かに次回へ
    const decision = resolveSecondaryAction(
      decideActiveSync(nasGenRef.current, nasGen, nasOwnerRef.current),
      driveAuthoritative,
    );
    if (decision === "pull") {
      const pulled = await pullActiveFromNas();
      if (pulled) {
        nasGenRef.current = nasGen;
        nasOwnerRef.current = false; // pull後は受動(次の人間の編集で再びbump)
        applyPulledNotes(pulled);
      }
    } else if (decision === "push") {
      await pushNasActiveNow();
    }
  }

  /** 初回表示時だけDriveの安全マージを補完する。定期実行はbackgroundの5分アラームが担う。 */
  async function runDriveSyncTick(): Promise<boolean> {
    const token = await getAuthToken(false); // 非対話——未接続ならnullで静かに終わる
    setDriveConnected(token !== null); // 5分毎に必ず通る唯一の経路なので接続状態の観測点にする
    if (!token) return false;
    const result = await syncDriveNotesSafely(
      notesRef.current ?? [],
      noteTombstonesRef.current,
      token,
      clockNow(),
    );
    if (!result) return false;
    applySafelySyncedNotes(result.notes, result.tombstones);
    return true;
  }

  /** 初回だけDrive安全マージ→NASの順で同期する。周期処理はそれぞれ別の単一経路へ分離済み。 */
  async function runSyncTick(): Promise<void> {
    const driveHandled = await runDriveSyncTick();
    await runNasSyncTick(driveHandled);
  }

  // NASの5分同期。Driveの5分同期はbackground service worker側に一本だけ張る。
  useEffect(() => {
    // Driveの5分周期はbackground service workerへ集約済み。タブ側の周期処理はNASだけ。
    const interval = setInterval(() => void runNasSyncTick(false), NAS_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
  // 開きっぱなしのタブへ戻ってきた時にも取り込む(ユーザー指示・2026-07-20)。新しいタブを
  // 開いた直後は下の初回effectが担うので、こちらはタブ/ウィンドウの切り替えで戻る経路を拾う。
  // 5分tickを待たずに他端末の変更が見えるようにするのが狙い。
  useForegroundSync(() => void runNasSyncTick(false), FOREGROUND_SYNC_MIN_INTERVAL_MS, clockNow);
  // ロード直後(notesが初めて入った時)に1回だけ初期同期する(pullで最新を取り込む)。
  const initialSyncDoneRef = useRef(false);
  useEffect(() => {
    if (!notes || initialSyncDoneRef.current) return;
    initialSyncDoneRef.current = true;
    void runSyncTick();
  }, [notes]);

  // スペシャル(⭐)を Google Drive の special/<folder>/<id>.md へ書き出す(ユーザー指示。NAS側は
  // 同期tickの pushSpecialToNas が担う)。スペシャル(ノートのstar/folder/本文 or 凍結項目)が
  // 変わった時だけ、5分debounceで push。Drive未接続なら静かに何もしない。
  const driveSpecialSigRef = useRef<string>("");
  useEffect(() => {
    if (!notes) return;
    // 「この端末のみ(noSync)」の live ノート・凍結項目は Drive の special ミラーにも出さない。
    const entries = specialEntries(
      excludeNoSyncNotes(notes),
      specialItems.filter((i) => !i.noSync),
    );
    const sig = specialSyncSignature(entries);
    if (sig === driveSpecialSigRef.current) return;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const token = await getAuthToken(false);
          if (!token) return;
          await pushSpecialToDrive(entries, token);
          driveSpecialSigRef.current = sig;
        } catch {
          // Drive同期の失敗はUIを止めない(次のスペシャル変化で再試行)。
        }
      })();
    }, NAS_SYNC_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [notes, specialItems]);

  // NAS active への書き込みは上の世代同期(5分毎の push)に一本化した。各ペインの保存の瞬間
  // (SnapshotScheduler)は自動タグ付けだけを行い、タグは notes state に反映される——push はその
  // state を読むので「タグ確定後に書く」も自然に満たす。junk/空は push 側で除外。

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
        setBatteryAlarmActive(local.batteryAlarmActive ?? false);
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
    void patchLocalData({ alarmActive: false });
  }

  function stopBatteryAlarm() {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "stop-battery-alarm" });
    }
    setBatteryAlarmActive(false);
    void patchLocalData({ batteryAlarmActive: false });
  }

  // notes/syncがnullの間もHooksは同じ順番で呼ぶ必要があるため、早期returnより前に
  // (SPEC.md §4.6の単一レジストリを)構築する。中身が空でも安全なようbuild*関数側でガードする。
  const orderedNotes = useMemo(() => (notes ? sortedNotes(notes) : []), [notes]);
  const noteLinearIndices = useMemo(
    () => new Map(orderedNotes.map((note, index) => [note.id, index])),
    [orderedNotes],
  );
  const orderedBookmarks = useMemo(() => (sync ? sortedBookmarks(sync.bookmarks) : []), [sync]);
  // タグ候補(TODOリスト下で管理・LLMのタグ推定へ渡す優先候補)。設定にsync/バックアップされる。
  const tagCandidates = sync?.settings.tagCandidates ?? [];
  // ノートボードの列数を画面幅から決める(概ね1列280px。最大3列)。実測masonryでは各列の
  // 高さを比べて振り分けるため、列数はJSで知っている必要がある。
  const [columnCount, setColumnCount] = useState(() => noteColumnCountFor(window.innerWidth));
  useEffect(() => {
    const onResize = () => setColumnCount(noteColumnCountFor(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // 実測masonry(ユーザー選択「最密」): 各ノートペインの描画後の実高さを ResizeObserver で測り、
  // order(優先度)順に「その時点で一番低い列」へ入れていく(最密詰め)。列幅は一定なので列を
  // 移っても高さは変わらず、内容変更でのみ高さが変わる=再配置は入力時のみ起きる(ユーザー了承済み)。
  const [noteHeights, setNoteHeights] = useState<Map<string, number>>(new Map());
  const reportNoteHeight = useCallback((id: string, h: number) => {
    setNoteHeights((prev) => {
      // 同一値なら参照を変えない(ResizeObserverの再発火→再レンダのループを断つ)。
      if (Math.abs((prev.get(id) ?? -1) - h) < 0.5) return prev;
      const next = new Map(prev);
      next.set(id, h);
      return next;
    });
  }, []);
  // 各ノートの置き場所(列index・列内のtop座標)と、ボード全体の高さ。**DOMの並びは常に
  // order順のまま**にして、列は絶対配置(CSSのleft)＋topのpxで表現する。列ごとの<div>へ振り分けて
  // いた頃は、ノートが1件増減するだけでセルが別の列(＝別の親DOM)へ移り、Reactが再マウントして
  // CodeMirrorが破棄され「入力中にカーソルが飛び以降の打鍵が消える」実害が出ていた(2026-07-23)。
  // 親が変わらなければ配置が変わってもCM6は生き続ける——position/top/leftだけが変わる。
  const noteLayout = useMemo(() => {
    const GAP = 16; // --space-3(tokens.css)と一致させる。topを実座標で置くのでズレは見た目に出る。
    const ESTIMATE = 520; // 未測定ノートの暫定高さ(ViewportNoteのプレースホルダ高と揃える)。
    const heights = new Array(columnCount).fill(0);
    const placement = new Map<string, { column: number; top: number }>();
    for (const note of orderedNotes) {
      let min = 0;
      for (let c = 1; c < columnCount; c++) if (heights[c] < heights[min]) min = c;
      placement.set(note.id, { column: min, top: heights[min] });
      heights[min] += (noteHeights.get(note.id) ?? ESTIMATE) + GAP;
    }
    // 絶対配置のセルは親の高さに寄与しないため、最も高い列ぶんの高さを明示する(最後のGAPは引く)。
    const boardHeight = Math.max(0, Math.max(0, ...heights) - GAP);
    return { placement, boardHeight };
  }, [orderedNotes, columnCount, noteHeights]);

  // 全データ(ブックマーク/ノート/設定/TODO/スペシャル)のJSONバックアップをdebounce付きで
  // 自動的にDriveへ同期する(ボタン操作不要。ノート本文の自動同期と同じ頻度・同じ設計思想)。
  // todos/specialItems/specialFoldersは元々このpayloadに含まれておらず退避/復元で欠落して
  // いた(ユーザー指摘・2026-07-16是正)。exportedAtは常に変わるため、依存が変化した時だけ
  // 再計算してdebounceを安定させる。
  const backupJson = useMemo(() => {
    if (!sync || !notes) return null;
    // 全データJSONバックアップはノート本文を丸ごと含むため、「この端末のみ(noSync)」は除外する。
    return serializeExport(
      buildExportPayload(
        sync,
        {
          notes: excludeNoSyncNotes(notes),
          todos,
          specialItems: specialItems.filter((i) => !i.noSync),
          specialFolders,
        },
        clockNow(),
      ),
    );
  }, [sync, notes, todos, specialItems, specialFolders]);
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
    // 全文検索は折りたたみ式になったため、Cmd/Ctrl+Fは開いてからフォーカスする
    // (未マウント時はsearchInputRef.currentがまだ無いので、実際のフォーカスは
    // 下のuseEffect(showSearchPanel依存)がマウント後に行う)。
    toggleSearch: () => {
      setShowSearchPanel(true);
      searchInputRef.current?.focus();
    },
    // 置換も全文検索の一部なので、同時に開く(replaceSignalはSearchPanel初回マウント時の
    // useEffectでも拾えるため、開くのと同時にインクリメントしてよい)。
    replaceInSearch: () => {
      setShowSearchPanel(true);
      setReplaceSignal((v) => v + 1);
    },
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

  // 「既に開いている状態でCmd/Ctrl+Fを再度押す」場合の再フォーカス用(このeffectは
  // ref.currentが既に存在する時だけ意味を持つ)。初回オープン時(SearchPanelはlazy+
  // Suspenseのため非同期マウント)のフォーカスはこのeffectのタイミングに間に合わない
  // ことがあるため、SearchPanel側の検索欄にautoFocusを付けてマウント自体で保証している
  // (2026-07-18)。
  useEffect(() => {
    if (showSearchPanel) searchInputRef.current?.focus();
  }, [showSearchPanel]);

  // ノート本文の文字サイズ(px)をCSS変数--note-font-sizeへ流し込む(styles/components.cssの.cm-editorが参照)。
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

  // 人間がノートを操作したら、NAS世代同期の所有権をこのセッションが得る(初回だけbump——ユーザー指示
  // 「人間が操作しNASと通信し始めるとき、新しい世代をもらう」)。NAS未設定なら何もしない。
  // pull(NASで上書き)やロード時の末尾空補充はプログラム的更新なのでここを通さない。
  // bumpはCAS(claimNasOwnership。2026-07-19是正)——自分の知っている世代がもう古ければ
  // (他タブが先にbump/pushしていたら)所有権を得ず、まずpullしてローカルを最新化する。
  // 以前は無条件bumpだったため、他タブの削除をpullしていないタブが所有権を奪ってしまい、
  // 次のpushで削除前の古いノート一覧がNASへ書き戻される(削除が復活する)実害があった。
  // Drive側も同じ考え方で独立にbumpする(ユーザー指示: 接続がうまく行った方の世代だけを
  // 進めることで抜けの無い情報受け渡しの土台にする)——NASが未設定/未接続でもDrive側は
  // 試みる(どちらか一方が失敗してももう一方は進む、が本来の狙いのため早期returnで
  // まとめない)。Drive側はまだpullで戻す経路が無いため、CAS化は現状スコープ外
  // (src/lib/drive/CLAUDE.md参照——将来マルチデバイス対応時に揃える)。
  function markUserEdit() {
    if (!nasOwnerRef.current) {
      nasOwnerRef.current = true; // 楽観的に所有者化(bump失敗時も次tickでpush可否を再判定)
      void (async () => {
        const result = await claimNasOwnership(nasGenRef.current);
        if (result.kind === "no-nas" || result.kind === "network-error") return;
        if (result.kind === "claimed") {
          nasGenRef.current = result.generation;
          await patchLocalData({ nasGeneration: result.generation });
          return;
        }
        // stale: 自分の知っている世代は既に古い(他タブが先にbump/pushしていた)。所有権の
        // 主張を取り消し、pull結果があればローカルへ反映する(このタブの直前の編集は
        // pull結果で上書きされ得る——複数タブがほぼ同時に競合編集した際のトレードオフだが、
        // 少なくとも「古い状態がpushされて他タブの削除がロールバックされる」実害は防げる)。
        nasOwnerRef.current = false;
        if (result.pulledNotes) {
          nasGenRef.current = result.generation;
          applyPulledNotes(result.pulledNotes);
          await patchLocalData({ nasGeneration: result.generation });
        }
        // pull失敗時はnasGenRef.currentを進めない→次のtickのdecideActiveSyncが
        // 「NASの方が新しい」と自然に判定してpullを再試行する。
      })();
    }
  }

  function updateNotes(update: Note[] | ((prev: Note[]) => Note[])) {
    // pull/初期化はrepository専用経路を通るため、ここへ来る更新は人間の操作として扱う。
    markUserEdit();
    // 常にsetNotesの関数型updaterを経由する(引数が配列であっても内部で関数化する)。
    // 「タブ追加ボタンを連打すると作ったノートが消える」バグの原因は、複数の呼び出しが
    // それぞれ古いclosure内のnotes(propsとして渡された時点のスナップショット)から
    // 新しい配列を計算し、後勝ちでsetNotesしていたこと(1個目の追加が2個目の呼び出しの
    // 計算元に含まれておらず上書きされて消えていた)。Reactは関数型updaterを
    // キューされた順に必ず正しいprevへ適用するため、呼び出しが連続してもデータが
    // 失われない。
    setNotes((prev) => {
      const base = prev ?? [];
      const rawNextNotes = typeof update === "function" ? update(base) : update;
      const changedAt = clockNow();
      const nextNotes = stampChangedNotes(base, rawNextNotes, changedAt);
      // 変更されたノートidを出す(入力=1件のことが多い。多数出るなら別要因を疑う)。
      const rawById = new Map(base.map((n) => [n.id, n]));
      const touched = nextNotes
        .filter((n) => JSON.stringify(rawById.get(n.id)) !== JSON.stringify(n))
        .map((n) => n.id.slice(0, 8));
      logOp(
        "notes",
        "update",
        `base=${base.length} next=${nextNotes.length} ` +
          `touched=${touched.length}[${touched.join(",")}] active=${activeNoteId?.slice(0, 8) ?? "none"}`,
      );
      noteTombstonesRef.current = updateTombstonesForMutation(
        base,
        nextNotes,
        noteTombstonesRef.current,
        changedAt,
      );
      // 永続化へ渡すのは全件スナップショットではなく、この操作のbefore/afterだけ。
      // repositoryが排他ロック内で最新状態へ差分を適用する。
      void commitNoteMutation(base, nextNotes, changedAt).then((committed) => {
        const revision = committed.storageRevision ?? 0;
        if (revision < storageRevisionRef.current) {
          logOp(
            "notes",
            "commit-stale",
            `rev=${revision} have=${storageRevisionRef.current} (dropped)`,
          );
          return;
        }
        storageRevisionRef.current = revision;
        noteTombstonesRef.current = committed.noteTombstones ?? {};
        // 自分の確定コミットではエディタ版数を進めない。本文はCM6が既に保持しており、
        // repositoryが追加した末尾空ノート等の構造差分だけをReact stateへ取り込む。
        logOp(
          "notes",
          "commit-applied",
          `rev=${revision} committed=${committed.notes.length} (was next=${nextNotes.length}, ` +
            `delta=${committed.notes.length - nextNotes.length})`,
        );
        // ただし編集中(フォーカス中/未保存)のノートは、コミット結果より新しいローカルの打鍵を
        // 保持しているため local 版で不可侵にする(排他ロック中に別tickの構造差分が混ざっても
        // 編集中ノートの本文を巻き戻さない)。commit往復もここで同じ合流点の保護を通す。
        setNotes(
          preserveProtectedNotes(
            committed.notes,
            notesRef.current ?? [],
            protectedNoteIds(),
            committed.noteTombstones ?? {},
          ),
        );
      });
      if (activeNoteId && !nextNotes.some((n) => n.id === activeNoteId)) {
        logOp(
          "notes",
          "active-lost",
          `active=${activeNoteId.slice(0, 8)} not in next → reset to [0]`,
        );
        setActiveNoteId(nextNotes[0]?.id ?? null);
      }
      return nextNotes;
    });
  }

  // 全文検索を拡張した一括置換(ユーザー指示: 対象ノートを選んで置換)。選んだノートのうち
  // 実際に本文が変わった件数を返す(SearchPanel側の結果メッセージ表示に使う)。
  function replaceTextInNotes(query: string, replacement: string, targetIds: Set<string>): number {
    let changedCount = 0;
    updateNotes((prev) => {
      const next = replaceInNotes(prev, query, replacement, targetIds, clockNow());
      changedCount = next === prev ? 0 : next.filter((n, i) => n !== prev[i]).length;
      return next;
    });
    // 開いているエディタ(Notepad/CM6)は本文をマウント時にしか読まないため、置換した本文を
    // 画面へ反映するには再マウントさせる合図が要る(上のNoteEditorPane propコメント参照)。
    // 再マウントは content prop(=draft優先)を読み直すので、置換対象のドラフトは破棄しておく——
    // さもないと置換前の打鍵を保持したドラフトが復活して置換結果を隠す。
    if (changedCount > 0) {
      for (const id of targetIds) draftContentRef.current.delete(id);
      setReplaceContentVersion((v) => v + 1);
    }
    return changedCount;
  }

  function updateTodos(nextTodos: Todo[]) {
    setTodos(nextTodos);
    void patchLocalData({ todos: nextTodos });
  }

  // スペシャル(⭐)の凍結項目/フォルダを更新して永続化する(ユーザー指示)。
  function updateSpecialItems(next: SpecialItem[]) {
    setSpecialItems(next);
    void patchLocalData({ specialItems: next });
  }
  // ⭐トグル(ノートのspecialを反転)。
  function toggleSpecial(noteId: string) {
    updateNotes((prev) => toggleNoteSpecial(prev, noteId));
  }
  // ノート削除。スター済みなら削除時の内容で凍結してスペシャルへ残す(ユーザー指示)。
  function deleteNote(noteId: string) {
    const target = (notes ?? []).find((n) => n.id === noteId);
    const frozen = target ? freezeNoteToSpecial(target, clockNow()) : null;
    if (frozen) updateSpecialItems(upsertSpecialItem(specialItems, frozen));
    updateNotes((prev) => removeNote(prev, noteId));
  }
  // スペシャルから外す(live=スター解除 / frozen=凍結項目を削除)。
  function removeSpecial(id: string, source: "live" | "frozen") {
    if (source === "live") updateNotes((prev) => updateNote(prev, id, { special: false }));
    else updateSpecialItems(removeSpecialItem(specialItems, id));
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
  function moveNoteDownOne(noteId: string) {
    updateNotes((prev) => moveNoteDown(prev, noteId));
  }
  // ペインをまたぐドラッグ交換: 掴んだノートidをrefに置き(refは同期更新なので再レンダ待ちに
  // 依存しない)、別ペインへdropしたらその位置へ移動する。DataTransferは使わない
  // (合成DnDテスト環境ではペイン間でDataTransferが運ばれないため、refで確実に受け渡す)。
  function handleNoteDragStart(noteId: string) {
    dragNoteIdRef.current = noteId;
  }
  // 画像の貼り付け/ドロップをそのノートへ添付する。保存先はNASのみ——NAS未登録なら保存せず、
  // 本文にも何も書かない(参照だけ残って永久に表示できない状態を作らない)。
  async function attachNoteImage(noteId: string, blob: Blob): Promise<string | null> {
    const relPath = await noteImages.attach(noteId, blob);
    if (relPath === null) {
      setDataPanelMessage(
        "画像を保存できませんでした(NASフォルダが未設定か、NASブリッジへ接続できません)",
      );
      return null;
    }
    return markdownImageReference(relPath);
  }

  function handleNoteDrop(targetId: string) {
    const fromId = dragNoteIdRef.current;
    dragNoteIdRef.current = null;
    if (fromId && fromId !== targetId) {
      updateNotes((prev) => reorderNotesById(prev, fromId, targetId));
    }
  }

  // 空でない全ノートの中で再タグ付けが必要なもの(needsRetag)にGeminiでタグを付ける共通処理。
  // 「🏷️ タグをふる」ボタン(handleTagAll)だけでなく、NAS書き込み(pushNasActiveNow)・
  // Drive退避(handleBackupToDrive)の先頭からも呼ぶ(ユーザー指示: 書き込み/退避が実行される
  // 前に、まず空でない全ノートにGeminiをかけてから書き込み・退避を行ってほしい)。
  // APIキー未設定/対象無しなら静かに何もしない(明示的な案内は handleTagAll 側だけが出す——
  // 書き込み/退避のたびに毎回警告を出すと日常操作で煩わしいため)。件数を返す。
  async function tagAllNotes(): Promise<{ targetCount: number; done: number; junkCount: number }> {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) return { targetCount: 0, done: 0, junkCount: 0 };
    const all = notesRef.current ?? [];
    // 「この端末のみ(noSync)」は Gemini(=Googleのサーバー)へ本文を送らない。
    const targets = all.filter((n) => needsRetag(n) && !n.noSync);
    if (targets.length === 0) return { targetCount: 0, done: 0, junkCount: 0 };
    // タグ候補＋既存ノートの頻出タグ(最大200)を語彙として渡し、タグの統一を促す(ユーザー指示)。
    const vocabulary = buildTagVocabulary(tagCandidates, all);
    let done = 0;
    let junkCount = 0;
    for (const note of targets) {
      const { tags, junk, title } = await analyzeNote(note.content, apiKey, {}, vocabulary);
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
    if (done > 0) refreshGeminiUsage(); // 大量のGemini呼び出し直後は使用量を即時に反映する(警告の出遅れ防止)。
    return { targetCount: targets.length, done, junkCount };
  }

  // 「🏷️ タグをふる」ボタン: tagAllNotesを実行し、進捗/結果メッセージを表示する。
  async function handleTagAll() {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      setDataPanelMessage("Gemini APIキーを設定してください(データ管理の「Gemini APIキー」ボタン)");
      return;
    }
    const all = notesRef.current ?? [];
    const targetCount = all.filter(needsRetag).length;
    if (targetCount === 0) {
      setDataPanelMessage("タグ付けが必要なノートはありません(変更なしのためスキップ)");
      return;
    }
    setTagging(true);
    setDataPanelMessage(`${targetCount}件のノートにGeminiでタグ付け中…`);
    const { done, junkCount } = await tagAllNotes();
    setTagging(false);
    setDataPanelMessage(
      `タグ付け完了: ${done}件に付与(未変更でスキップ${all.length - targetCount}件` +
        `${junkCount > 0 ? `・ゴミ判定${junkCount}件はNAS保管対象外` : ""})`,
    );
    // タグが付いたノートを次の5分ティックまで待たせず即座にNAS/Driveへ反映する(ユーザー指示:
    // タグ付けボタンを押したものは待たずに保存対象にしてほしい)。「今すぐNASへ書き出し」/
    // 「Driveへ退避」と同じ即時pushを流用する(いずれも先頭でtagAllNotesを呼ぶが、既に
    // タグ付け済みなので二重コストにはならない)。Drive側は非対話トークンが取れる時だけ
    // (未接続なら静かにスキップ——日常のタグ付けでOAuthポップアップを出さないため)。
    if (done > 0) {
      await pushNasActiveNow();
      const token = await getAuthToken(false);
      if (token) await pushDriveActiveNow(token);
    }
  }

  // 「☁️ Driveへ退避」: 自動同期を待たず、現在の全データを今すぐDriveへ書き出す(退避の即時版)。
  // Driveの「push」本体(「Driveへ退避」ボタンから即座に呼ぶ専用。ユーザー指示: 押した瞬間に
  // 現在のノートをapp/New Tab Board/active/と今日の日付フォルダへ反映してほしい)。
  // ハッシュで保存済みか判定して変わったノートだけ送り(pushNasActiveNowと同じ発想。ユーザー指示:
  // 変更が無いノートを送るな)、消えたノートはreconcileDriveActiveが削除する。
  async function pushDriveActiveNow(token: string): Promise<void> {
    // 書き込み前に、空でない全ノートへGeminiをかけてタグを最新化する(ユーザー指示: Driveへの
    // 書き込みが実行される前にタグ付けを済ませてほしい)。pushNasActiveNowと同じ理由。
    await tagAllNotes();
    const now = clockNow();
    const result = await syncDriveNotesSafely(
      notesRef.current ?? [],
      noteTombstonesRef.current,
      token,
      now,
    );
    if (!result) return;
    applySafelySyncedNotes(result.notes, result.tombstones);
    await copyNotesToDriveDateFolder(result.notes, now, token);
    // TODOはactive/todos.txtへも書く(ユーザー指示: 「二重管理でもいい」ので設定バックアップ
    // (jsonBackup)とは別にactive/へ直接反映する。NAS側と同じ発想)。
    const todosMd = todosToMarkdown(todosRef.current);
    const todosSig = contentHash(todosMd);
    if (todosSig !== driveTodosSigRef.current) {
      if (await pushTodosToDriveActive(todosRef.current, token)) {
        driveTodosSigRef.current = todosSig;
      }
    }
  }

  async function handleBackupToDrive() {
    if (!backupJson) return; // 準備ができているか(sync/notesがまだ無ければ何もしない)のゲート
    // 退避前に、空でない全ノートへGeminiをかけてタグを最新化する(ユーザー指示: 書き込み/退避が
    // 実行される前にタグ付けを済ませてほしい)。tagAllNotesはupdateNotes経由でReact stateを
    // 更新するため、クロージャに閉じ込められたbackupJson(useMemo)はタグ付け前のスナップショット
    // のまま古くなる——refsから読み直して最新のタグを含んだJSONを組み直す。
    await tagAllNotes();
    setDataPanelMessage("Google Driveへ退避中…");
    const freshBackupJson = sync
      ? serializeExport(
          buildExportPayload(
            sync,
            {
              // 「この端末のみ(noSync)」は Drive への退避JSONにも含めない。
              notes: excludeNoSyncNotes(notesRef.current ?? []),
              todos: todosRef.current,
              specialItems: specialItemsRef.current.filter((i) => !i.noSync),
              specialFolders: specialFoldersRef.current,
            },
            clockNow(),
          ),
        )
      : backupJson;
    const result = await syncJsonBackupToDrive(
      freshBackupJson,
      clockNow(),
      true,
      sync?.settings.jsonBackupFileId,
    );
    if (result.status === "synced") {
      updateSettings({ jsonBackupFileId: result.fileId });
      // 設定バックアップだけでなく、現在開いているノートも即座にactive/と今日の日付フォルダへ
      // 反映する(ユーザー指示: 退避ボタンを押した時点の状態を通常同期のタイミングを待たずに
      // Driveへ)。JSONバックアップと同じ認証(非対話——既にsynced実績があるのでトークンは
      // 取得済みのはず)を使い回す。
      const token = await getAuthToken(false);
      if (token) await pushDriveActiveNow(token);
      setDataPanelMessage("Google Driveへ退避しました(以後の変更は自動でも同期されます)");
    } else if (result.status === "unauthenticated") {
      setDataPanelMessage(
        "Googleアカウントにログインできませんでした(「GDrive設定」から接続してください)",
      );
    } else if (result.status === "skipped-empty-guard") {
      setDataPanelMessage(
        "ブックマークが空のためDriveへの退避を安全のため中止しました" +
          "(既存のDriveバックアップにはブックマークが残っています。" +
          "手元のブックマークが正しいか確認してからもう一度お試しください)",
      );
    } else {
      setDataPanelMessage("Driveへの退避に失敗しました");
    }
  }

  // 「NASから復元」: NASのdata/settings-backup.json(notesを除く、テーマ/TODO/ブックマーク/
  // ノート文字サイズ/スペシャル/タグ候補)を読み戻して適用する(ユーザー指示: NASにも保存し、
  // NASからも復元できるように)。notesはNAS active の世代同期(pullActiveFromNas)が別途担う
  // ため、ここでは触らない——2つの復元経路を混ぜるとどちらが正かが曖昧になる。
  async function handleRestoreFromNas() {
    setDataPanelMessage("NASから復元中…");
    const payload = await pullSettingsBackupFromNas();
    if (!payload) {
      setDataPanelMessage(
        "NASに設定バックアップがまだありません(NAS未設定か、まだ一度も保存されていません)",
      );
      return;
    }
    const nextSync: SyncState = {
      bookmarks: payload.bookmarks,
      appLaunches: payload.appLaunches,
      settings: payload.settings,
    };
    setSync(nextSync);
    setTodos(payload.todos);
    setSpecialItems(payload.specialItems);
    setSpecialFolders(payload.specialFolders);
    void saveSyncData(nextSync);
    void patchLocalData({
      todos: payload.todos,
      specialItems: payload.specialItems,
      specialFolders: payload.specialFolders,
    });
    setDataPanelMessage("NASから復元しました(ノートは対象外——NASの世代同期が別途復元します)");
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

  function importData(data: {
    sync: SyncState;
    notes: Note[];
    todos?: Todo[];
    specialItems?: SpecialItem[];
    specialFolders?: string[];
  }) {
    setSync(data.sync);
    setNotes(data.notes);
    setActiveNoteId(data.notes[0]?.id ?? null);
    // todos/specialItems/specialFoldersは旧形式のバックアップ(このフィールドが無い)を
    // 復元した場合にundefinedになりうる——その時は現状を消さず維持する(空へ上書きしない)。
    if (data.todos !== undefined) setTodos(data.todos);
    if (data.specialItems !== undefined) setSpecialItems(data.specialItems);
    if (data.specialFolders !== undefined) setSpecialFolders(data.specialFolders);
    void saveSyncData(data.sync);
    const importedNotes = ensureTrailingEmptyNotes(data.notes, TRAILING_EMPTY_NOTES, clockNow());
    void updateLocalData((current) => ({
      ...current,
      notes: importedNotes,
      noteTombstones: {},
      todos: data.todos ?? current.todos,
      specialItems: data.specialItems ?? current.specialItems,
      specialFolders: data.specialFolders ?? current.specialFolders,
    }));
  }

  function openFileAsNote(
    title: string,
    content: string,
    meta?: { sourceNoteId?: string; generatedBy?: string },
  ) {
    // 件数を order に使うと削除で疎になった既存 order と衝突して途中へ割り込む(notes.ts参照)。
    const note = createNote(title, nextNoteOrder(notes ?? []), clockNow());
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
        accentColor="blue"
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
      accentColor="blue"
      grayColor="slate"
      radius="large"
      panelBackground="solid"
    >
      <Box p={{ initial: "3", sm: "5" }}>
        <Flex asChild direction="column" gap="4">
          <main data-testid="app-root">
            {geminiUsageToday >= GEMINI_DAILY_WARN_THRESHOLD ? (
              <Card data-testid="gemini-usage-warning" className="callout callout-warning">
                <Text size="3" weight="medium" color="orange">
                  <Flex align="center" gap="2" as="span">
                    <AlertTriangle size={16} aria-hidden="true" />
                    本日のGemini使用が{geminiUsageToday}回に達しました(しきい値
                    {GEMINI_DAILY_WARN_THRESHOLD})。無料枠を使い切る前に、GPT-OSS 120Bへの乗り換えを
                    検討してください。
                  </Flex>
                </Text>
              </Card>
            ) : null}
            {countdown.kind === "upcoming" ? (
              <Card
                data-testid="next-event-countdown"
                className="callout callout-info"
                title="Googleカレンダーの次の予定まで"
              >
                <Text size="3" weight="medium">
                  <Flex align="center" gap="2" as="span">
                    <CalendarClock size={16} aria-hidden="true" />
                    次の予定まで {formatCountdown(countdown)}({countdown.title})
                  </Flex>
                </Text>
              </Card>
            ) : null}
            {countdown.kind === "in-progress" ? (
              <Card data-testid="next-event-countdown" className="callout callout-info">
                <Text size="3" weight="medium">
                  <Flex align="center" gap="2" as="span">
                    <CalendarClock size={16} aria-hidden="true" />
                    予定は進行中です
                  </Flex>
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
                <BellOff size={14} aria-hidden="true" />
                アラーム停止
              </Button>
            ) : null}
            {batteryAlarmActive ? (
              <Button
                type="button"
                color="red"
                data-testid="stop-battery-alarm"
                title="スマホのバッテリー低下警告の音を止める"
                onClick={stopBatteryAlarm}
              >
                <BatteryWarning size={14} aria-hidden="true" />
                バッテリー警告停止
              </Button>
            ) : null}

            {/* テーマ選択の右側が常に余っていたため、データ操作/ショートカット一覧の
                トグルボタンをそこへ寄せた(ユーザー指示)。展開ボタン自体はヘッダーの
                小さな行に収まり、実際のDataPanel本文は従来どおりブックマーク欄の下に
                フル幅で展開する(ヘッダーの狭い右側にボタン10個を詰め込むと窮屈なため)。 */}
            <Flex asChild align="center" justify="between" gap="4" wrap="wrap">
              <header className="app-header">
                <Flex align="center" gap="4" wrap="wrap">
                  <Clock />
                  <ThemeToggle
                    theme={sync.settings.theme}
                    onThemeChange={(theme) => updateSettings({ theme })}
                  />
                </Flex>
                <Flex asChild align="center" gap="3" wrap="wrap">
                  <nav>
                    {/* データ操作(ファイルを開く/Drive・NAS操作等)は普段使わず高さだけ食うため、
                        既定で折りたたみ、押した時だけ展開する(ユーザー指示)。折りたたみ中は
                        DataPanelごとアンマウントする(display:noneではなく非表示——高さを
                        完全にゼロにするため)。 */}
                    <Button
                      type="button"
                      variant={showDataPanel ? "solid" : "soft"}
                      size="2"
                      data-testid="toggle-data-panel"
                      title={
                        showDataPanel
                          ? "データ操作パネルを閉じる"
                          : "データ操作パネルを開く(ファイルを開く/Drive・NAS操作など)"
                      }
                      onClick={() => setShowDataPanel((v) => !v)}
                    >
                      <Wrench size={14} aria-hidden="true" />
                      データ操作
                      {showDataPanel ? (
                        <ChevronUp size={14} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={14} aria-hidden="true" />
                      )}
                    </Button>
                    {/* Drive未接続の警告。折りたたまれるDataPanelの中ではなくここ(常時表示)に
                        出すのが要点——2026-07-18〜20はDrive連携が丸2日停止していたのに何の
                        表示も無く気づけなかった。押すとDataPanelが開き「GDrive設定」へ誘導する。
                        接続中・未判定(null)のときは何も出さない(平常時に雑音を足さない)。 */}
                    {driveConnected === false ? (
                      <Button
                        type="button"
                        variant="solid"
                        color="orange"
                        size="2"
                        data-testid="drive-disconnected-warning"
                        title="Google Driveへ未接続です。ノートの同期とDrive上の削除反映が停止しています。押すとデータ操作パネルが開くので「GDrive設定」から再接続してください"
                        onClick={() => setShowDataPanel(true)}
                      >
                        <CloudOff size={14} aria-hidden="true" />
                        Drive未接続
                      </Button>
                    ) : null}
                    {/* ヘルプ系は使用頻度が低いため、日常操作のボタンより右に置く(ユーザー指示)。 */}
                    <Button
                      type="button"
                      variant="soft"
                      data-testid="open-shortcuts-modal"
                      title="使えるキーボードショートカットの一覧を表示する"
                      onClick={() => setShowShortcutsModal(true)}
                    >
                      <Keyboard size={14} aria-hidden="true" />
                      ショートカット一覧(?)
                    </Button>
                  </nav>
                </Flex>
              </header>
            </Flex>

            {/* データ操作パネルはブックマークバーの上に置く(ユーザー指示)。 */}
            {showDataPanel ? (
              <DataPanel
                sync={sync}
                onImportData={importData}
                onOpenFileAsNote={openFileAsNote}
                onMessage={setDataPanelMessage}
                onBackupToDrive={() => void handleBackupToDrive()}
                onRestoreFromNas={() => void handleRestoreFromNas()}
                onPushNasActiveNow={pushNasActiveNow}
                driveConnected={driveConnected}
                onDriveConnectionChange={setDriveConnected}
              />
            ) : null}

            <BookmarkGrid
              bookmarks={sync.bookmarks}
              openIn={sync.settings.openIn}
              onBookmarksChange={updateBookmarks}
            />

            {/* データ操作ツールバー(ファイルを開く/NASへ書き出し等)と、この下のノート域
                (ノート文字サイズ等)の間に区切り線を入れる(ユーザー指示)。 */}
            <hr className="toolbar-divider" data-testid="toolbar-divider" />

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
                {/* スペシャル(⭐)は TODO の下・タグ候補の上に置く(ユーザー指示)。 */}
                <SpecialPanel
                  notes={notes}
                  specialItems={specialItems}
                  onSelectNote={selectNote}
                  onRemove={removeSpecial}
                />
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
                      <Tag size={14} aria-hidden="true" />
                      {tagging ? "タグ付け中…" : "まとめてタグをふる"}
                    </Button>
                    {/* 全文検索・NAS検索も普段使わず高さだけ食うため、データ操作パネルと
                        同じ折りたたみ式にした(ユーザー指示・2026-07-18)。 */}
                    <Button
                      type="button"
                      variant={showSearchPanel ? "solid" : "soft"}
                      size="1"
                      data-testid="toggle-search-panel"
                      title={showSearchPanel ? "全文検索を閉じる" : "全文検索を開く(Cmd/Ctrl+F)"}
                      onClick={() => setShowSearchPanel((v) => !v)}
                    >
                      <Search size={14} aria-hidden="true" />
                      全文検索
                      {showSearchPanel ? (
                        <ChevronUp size={14} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={14} aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant={showTagSearchPanel ? "solid" : "soft"}
                      size="1"
                      data-testid="toggle-tag-search-panel"
                      title={
                        showTagSearchPanel ? "NAS検索を閉じる" : "NAS検索を開く(タグ・本文・期間)"
                      }
                      onClick={() => setShowTagSearchPanel((v) => !v)}
                    >
                      <Tag size={14} aria-hidden="true" />
                      NAS検索
                      {showTagSearchPanel ? (
                        <ChevronUp size={14} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={14} aria-hidden="true" />
                      )}
                    </Button>
                  </Flex>
                  {showSearchPanel ? (
                    <Suspense fallback={<div data-testid="search-loading">検索を読み込み中…</div>}>
                      <SearchPanel
                        ref={searchInputRef}
                        notes={notes}
                        onSelectNote={(noteId) => selectNote(noteId)}
                        replaceSignal={replaceSignal}
                        onReplace={replaceTextInNotes}
                      />
                    </Suspense>
                  ) : null}
                </div>
                {showTagSearchPanel ? (
                  <TagSearchPanel
                    notes={notes}
                    onSelectNote={selectNote}
                    onPasteResults={pasteSearchResults}
                  />
                ) : null}
                {orderedNotes.length > 0 ? (
                  // 実測masonry: order順の全ノートを「その時点で一番低い列」へ入れて縦積みする
                  // (短いノートの真下に次が詰まり、長いノートで隣が伸びない——ユーザー指示)。
                  // 編集シーム(ドラフトバッファ＋編集レジストリ)を全ペインへ配る。
                  <EditingSeamProvider seam={editingSeam}>
                    {/* DOMの並びはorder順のまま・列は絶対配置で表現する(上のnoteLayoutのコメント参照)。
                        JSX子要素の位置では // はコメントにならず画面に描画されてしまう——必ずこの形式で書く。 */}
                    <div
                      className="note-board"
                      data-testid="note-board"
                      style={
                        {
                          height: `${noteLayout.boardHeight}px`,
                          "--note-columns": columnCount,
                        } as CSSProperties
                      }
                    >
                      {orderedNotes.map((note) => (
                        <ViewportNote
                          key={note.id}
                          noteId={note.id}
                          title={note.title}
                          linearIndex={noteLinearIndices.get(note.id) ?? -1}
                          columnIndex={noteLayout.placement.get(note.id)?.column ?? 0}
                          top={noteLayout.placement.get(note.id)?.top ?? 0}
                          active={note.id === activeNoteId}
                          estimatedHeight={noteHeights.get(note.id)}
                          contentVersion={note.updatedAt}
                          onHeight={reportNoteHeight}
                          onSuspend={() => void forceSnapshot(note.id, note.content)}
                        >
                          <NoteEditorPane
                            note={note}
                            notes={notes}
                            tagCandidates={tagCandidates}
                            isActive={note.id === activeNoteId}
                            isFirst={orderedNotes[0]?.id === note.id}
                            isLast={orderedNotes[orderedNotes.length - 1]?.id === note.id}
                            autoFocus={note.id === activeNoteId && userSelectedNoteRef.current}
                            manualSyncSignal={manualSyncSignal}
                            replaceContentVersion={
                              replaceContentVersion + (syncedContentVersions[note.id] ?? 0)
                            }
                            onNotesChange={updateNotes}
                            onSelectNote={selectNote}
                            onSelectNoteByTitle={selectNoteByTitle}
                            onCreateNote={openFileAsNote}
                            onAddTodos={addTodos}
                            onMessage={setDataPanelMessage}
                            onTogglePin={togglePinNote}
                            onToggleSpecial={toggleSpecial}
                            onDeleteNote={deleteNote}
                            onMoveUp={moveNoteUpOne}
                            onMoveDown={moveNoteDownOne}
                            onDragStartNote={handleNoteDragStart}
                            onDropNote={handleNoteDrop}
                            noteImageUrls={noteImages.urls}
                            onAttachImage={attachNoteImage}
                          />
                        </ViewportNote>
                      ))}
                    </div>
                  </EditingSeamProvider>
                ) : (
                  <Card data-testid="no-notes">
                    <Text size="3" weight="medium" color="blue">
                      <Flex align="center" gap="2" as="span">
                        <StickyNote size={16} aria-hidden="true" />
                        ノートがありません。上の「+ ノート」ボタンを押すと書き始められます
                      </Flex>
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
          <ArrowUpIcon size={20} aria-hidden="true" />
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
          <ArrowDown size={20} aria-hidden="true" />
        </button>
      </div>
    </Theme>
  );
}
