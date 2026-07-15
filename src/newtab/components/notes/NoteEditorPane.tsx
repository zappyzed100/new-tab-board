// NoteEditorPane.tsx — ノート編集エリア1件分(SPEC.md §4.2)
// 複数ノートを横並び表示する際、1ペイン=1コンポーネントインスタンスとして完全に独立させる
// (プレビュー/履歴表示・Drive同期状態はペインごとに別々でよい概念のため)。全文検索だけは
// 「全ノート横断」という性質上グローバル据え置き(App.tsx側のまま)。
import { lazy, Suspense, useEffect, useState } from "react";
import { Badge, Card, Checkbox, Flex, IconButton, Text } from "@radix-ui/themes";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckSquare,
  Copy,
  Eraser,
  GripVertical,
  History,
  Loader2,
  Pencil,
  Pin,
  Sparkles,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { BacklinksPanel } from "./BacklinksPanel";
import { SnapshotScheduler } from "./SnapshotScheduler";
import type { DragEvent as ReactDragEvent } from "react";
import { isDefaultNoteTitle, mergeDroppedContent, updateNote } from "../../../lib/entities/notes";
import { now as clockNow } from "../../../lib/runtime/clock";
import { useDriveSync } from "../../../lib/drive/useDriveSync";
import { forceSnapshot } from "../../../lib/history/useSnapshotScheduler";
import { getGeminiApiKey } from "../../../lib/storage/db";
import { extractTodos, summarizeNote } from "../../../lib/gemini/noteAi";
import { analyzeNote, contentHash, needsRetag } from "../../../lib/gemini/tagging";
import { buildTagVocabulary } from "../../../lib/entities/tags";
import type { NoteAnalysis } from "../../../lib/gemini/tagging";
import type { Note } from "../../../types";

const GEMINI_KEY_HINT = "Gemini APIキーを設定してください(データ管理の「Gemini APIキー」ボタン)";

// 保存時の自動タグ付けを全ペイン横断で1件ずつに直列化するガード。blurでは複数ペインの
// スナップショットが同時に発火し、Geminiが429を返す前に複数fetchが飛んでクールダウンが
// 間に合わない問題を防ぐ(1件が終わるまで他の自動タグはスキップ——手動タグ/要約は対象外)。
let autoTagInFlight = false;

const DRIVE_SYNC_LABEL: Record<string, string> = {
  idle: "",
  syncing: "同期中…",
  synced: "同期済",
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
  /** タグ候補(ユーザーが並べた語彙)。Geminiのタグ推定へ「優先候補」として渡す。 */
  tagCandidates: string[];
  isActive: boolean;
  /** 順序列の先頭ノートか(「ひとつ上へ」を無効化するため)。 */
  isFirst: boolean;
  /** 順序列の末尾ノートか(「ひとつ下へ」を無効化するため)。 */
  isLast: boolean;
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
  /** ピン留めの切替(ピンしたノートは最優先で左上へ)。 */
  onTogglePin: (noteId: string) => void;
  /** ⭐スター(スペシャルへ保管)の切替。 */
  onToggleSpecial: (noteId: string) => void;
  /** ノート削除(スター済みならApp側でスペシャルへ凍結してから消す)。 */
  onDeleteNote: (noteId: string) => void;
  /** 順序列で1つ前(表示上ひとつ左上)のノートと入れ替える。 */
  onMoveUp: (noteId: string) => void;
  /** 順序列で1つ後ろ(表示上ひとつ右下)のノートと入れ替える。 */
  onMoveDown: (noteId: string) => void;
  /** ドラッグ交換: つまみを掴んだ時に自分のidを「掴んだノート」として通知する。 */
  onDragStartNote: (noteId: string) => void;
  /** ドラッグ交換: このペインへdropされた時、掴んだノートをここへ移動する。 */
  onDropNote: (targetNoteId: string) => void;
};

export function NoteEditorPane({
  note,
  notes,
  tagCandidates,
  isActive,
  isFirst,
  isLast,
  autoFocus,
  manualSyncSignal,
  onNotesChange,
  onSelectNote,
  onSelectNoteByTitle,
  onCreateNote,
  onAddTodos,
  onMessage,
  onTogglePin,
  onToggleSpecial,
  onDeleteNote,
  onMoveUp,
  onMoveDown,
  onDragStartNote,
  onDropNote,
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
    onMessage(`「${note.title}」にGeminiでタグ・タイトルを付与中…`);
    const vocabulary = buildTagVocabulary(tagCandidates, notes);
    const { tags, junk, title } = await analyzeNote(note.content, apiKey, {}, vocabulary);
    setAiBusy(null);
    if (tags.length === 0 && !junk && !title) {
      onMessage("タグ・タイトルを付けられませんでした(Gemini呼び出しに失敗した可能性)");
      return;
    }
    // 手動ボタン(タグ・タイトル)は明示操作なので、生成タイトルがあれば上書きする。
    onNotesChange((prev) =>
      updateNote(prev, note.id, {
        tags,
        junk,
        taggedHash: contentHash(note.content),
        ...(title ? { title } : {}),
      }),
    );
    onMessage(
      `「${title || note.title}」に${tags.length}件のタグ${title ? "とタイトル" : ""}を付けました` +
        `${junk ? "(ゴミ判定: NAS保管対象外)" : ""}`,
    );
  }

  // 保存(スナップショット)の瞬間に自動タグ付けする(ユーザー指示)。タグは notes state に反映され、
  // NAS active への書き込みは App の世代同期(5分毎の push)がその state を読んで行う——push は
  // state を読むので「タグ確定後に書く」も自然に満たす(NoteEditorPane からは NAS へ直接書かない)。
  // キー未設定・前回から変更なし・別ペイン処理中・意味のある結果なしは null(タグ付けせず)。
  async function runAutoTag(savedContent: string): Promise<NoteAnalysis | null> {
    if (!needsRetag({ content: savedContent, taggedHash: note.taggedHash })) return null;
    if (autoTagInFlight) return null; // 別ペインの自動タグ付けが進行中なら今回はスキップ(同時多発防止)
    const apiKey = await getGeminiApiKey();
    if (!apiKey) return null;
    autoTagInFlight = true;
    try {
      const analysis = await analyzeNote(
        savedContent,
        apiKey,
        {},
        buildTagVocabulary(tagCandidates, notes),
      );
      if (analysis.tags.length === 0 && !analysis.junk && !analysis.title) return null;
      onNotesChange((prev) => {
        // 自動付与では、既定タイトル(ノートX)のときだけ生成タイトルを入れる(手動命名は尊重)。
        const cur = prev.find((n) => n.id === note.id);
        const setTitle =
          analysis.title !== "" && cur !== undefined && isDefaultNoteTitle(cur.title);
        return updateNote(prev, note.id, {
          tags: analysis.tags,
          junk: analysis.junk,
          taggedHash: contentHash(savedContent),
          ...(setTitle ? { title: analysis.title } : {}),
        });
      });
      return analysis;
    } finally {
      autoTagInFlight = false;
    }
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

  // md/txt ファイルをこのノートへドロップしたら本文を取り込む(ユーザー指示)。CodeMirrorが
  // ドロップを飲む前に横取りするため capture フェーズで処理する。ファイルでなければ何もせず、
  // ノート入れ替えのドラッグ(dataTransferにFile無し)はそのまま onDrop→onDropNote へ通す。
  async function handleFileDropCapture(e: ReactDragEvent<HTMLElement>) {
    const file = e.dataTransfer?.files?.[0];
    if (!file || !/\.(md|txt)$/i.test(file.name)) return;
    e.preventDefault();
    e.stopPropagation(); // CM6にも下のonDropNote(入れ替え)にも渡さない
    const text = await file.text();
    onNotesChange((prev) => {
      const cur = prev.find((n) => n.id === note.id);
      return updateNote(prev, note.id, {
        content: mergeDroppedContent(cur?.content ?? "", text),
        updatedAt: clockNow(),
      });
    });
    setRestoreCounter((c) => c + 1); // CM6はマウント時しかcontentを読まないので再マウントで反映
    onMessage(`「${file.name}」の内容をノートへ取り込みました`);
  }

  // ファイルをドラッグ中はこの要素でドロップを受け付ける(CMのdragoverより先に許可する)。
  function handleFileDragOverCapture(e: ReactDragEvent<HTMLElement>) {
    if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
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
    <Card
      data-testid={`note-editor-area-${note.id}`}
      data-active={isActive || undefined}
      // 空ノートと非空ノートで背景色を変えて見分けられるようにする(ユーザー指示)。空=控えめなグレー。
      data-empty={note.content.trim() === "" || undefined}
      // ドラッグ交換の drop 先。掴んだノート(App側のrefが保持)をこのノートの位置へ移動する。
      // dropを許可するためdragOverでpreventDefaultする。本文中央はCodeMirrorがdropを飲むため、
      // 実質的にヘッダのつまみ帯へ落とす運用になる(掴んだノートidはApp側のrefで受け渡す)。
      // capture フェーズは md/txt ファイルのドロップ取り込み用(CMより先に横取りする)。
      onDragOverCapture={handleFileDragOverCapture}
      onDropCapture={(e) => void handleFileDropCapture(e)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDropNote(note.id)}
    >
      <Flex direction="column" gap="3">
        <SnapshotScheduler
          noteId={note.id}
          content={note.content}
          onSnapshot={(c) => void runAutoTag(c)}
        />
        {/* 1行目: ノート名を一番左上に、枠なし・太字・大きめで置く(クリックでそのまま編集)。
            その右に自由チェック(何とも連動しない)・ドラッグつまみ・同期状態、右端にピンアイコン。 */}
        <Flex align="center" gap="2">
          <input
            className="note-pane-title-input"
            data-testid={`note-title-${note.id}`}
            aria-label="ノート名"
            placeholder="(名称未設定)"
            value={note.title}
            onChange={(e) =>
              onNotesChange((prev) => updateNote(prev, note.id, { title: e.target.value }))
            }
          />
          {/* 自由に使えるチェック。ノートの見た目・並び・保存の何にも連動しない(ユーザー指示)。 */}
          <Checkbox
            data-testid={`check-note-${note.id}`}
            checked={note.done ?? false}
            title="自由に使えるチェック(ノートの見た目や動作には連動しません)"
            onCheckedChange={(checked) =>
              onNotesChange((prev) => updateNote(prev, note.id, { done: checked === true }))
            }
          />
          <span
            className="note-drag-handle"
            data-testid={`note-drag-handle-${note.id}`}
            role="button"
            tabIndex={0}
            aria-label="ドラッグでノートの位置を入れ替える"
            title="つまんでドラッグすると、ノートの位置を入れ替えられます"
            draggable
            onDragStart={(e) => {
              onDragStartNote(note.id);
              // FirefoxはsetDataしないとドラッグが開始しない。値自体はApp側refで受け渡すためダミー。
              // (合成dispatchEvent等でdataTransferが無い場合もあるため存在を確認する)
              if (e.dataTransfer) {
                e.dataTransfer.setData("text/plain", note.id);
                e.dataTransfer.effectAllowed = "move";
              }
            }}
          >
            <GripVertical size={16} aria-hidden="true" />
          </span>
          {/* 同期状態はボタンではないので、ノート名の最右端(ピンの左)に控えめに置く(ユーザー指示)。 */}
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
          {/* ⭐スター(スペシャルへ保管)。ノート名の右・ピンの左。スター中は塗りつぶし。 */}
          <IconButton
            type="button"
            variant={note.special ? "solid" : "soft"}
            data-testid={`star-note-${note.id}`}
            title={
              note.special
                ? "スターを外す(スペシャルから外す)"
                : "スターしてスペシャル(保管棚)に入れる"
            }
            onClick={() => onToggleSpecial(note.id)}
          >
            <Star size={14} aria-hidden="true" fill={note.special ? "currentColor" : "none"} />
          </IconButton>
          {/* ピンは説明なしのアイコンだけ・右端に(ユーザー指示)。ピン中は塗りつぶしで示す。 */}
          <IconButton
            type="button"
            variant={note.pinned ? "solid" : "soft"}
            data-testid={`pin-note-${note.id}`}
            title={
              note.pinned ? "ピンを外す(最優先の左上固定を解除)" : "ピン留めして最優先で左上に置く"
            }
            onClick={() => onTogglePin(note.id)}
          >
            <Pin size={14} aria-hidden="true" fill={note.pinned ? "currentColor" : "none"} />
          </IconButton>
        </Flex>
        {/* 2行目: 操作ボタンを全て「アイコン＋説明」で統一・順序も統一(移動→表示→AI→編集操作)。
            ピン/自由チェック/同期状態はノート名の行(1行目)へ移動済み。 */}
        <Flex align="center" gap="2" wrap="wrap">
          {/* 操作ボタンはアイコンのみ(説明はtitleツールチップ)にして3行以内に収める(ユーザー指示)。 */}
          <IconButton
            type="button"
            size="1"
            variant="soft"
            data-testid={`move-note-up-${note.id}`}
            title="優先度を上げる(ひとつ前=左上寄りへ移動。左上ほど優先度が高い)"
            disabled={isFirst}
            onClick={() => onMoveUp(note.id)}
          >
            <ArrowUp size={14} aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            size="1"
            variant="soft"
            data-testid={`move-note-down-${note.id}`}
            title="優先度を下げる(ひとつ後ろ=右下寄りへ移動)"
            disabled={isLast}
            onClick={() => onMoveDown(note.id)}
          >
            <ArrowDown size={14} aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            size="1"
            variant={showPreview ? "solid" : "soft"}
            data-testid={`toggle-preview-${note.id}`}
            title={showPreview ? "編集に戻す" : "Markdownを清書してプレビュー表示する"}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? (
              <Pencil size={14} aria-hidden="true" />
            ) : (
              <BookOpen size={14} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            type="button"
            size="1"
            variant={showHistory ? "solid" : "soft"}
            data-testid={`toggle-history-${note.id}`}
            title="過去のスナップショット一覧・差分表示・復元"
            onClick={() => setShowHistory((v) => !v)}
          >
            <History size={14} aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            size="1"
            variant="soft"
            data-testid={`summarize-${note.id}`}
            title="Geminiでこのノートを要約し、「〇〇の要約」ノートを新規作成する"
            disabled={aiBusy !== null}
            onClick={() => void handleSummarize()}
          >
            {aiBusy === "summary" ? (
              <Loader2 size={14} aria-hidden="true" className="spin" />
            ) : (
              <Sparkles size={14} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            type="button"
            size="1"
            variant="soft"
            data-testid={`extract-todos-${note.id}`}
            title="GeminiでこのノートからTODOを抽出し、TODOリストへ追加する"
            disabled={aiBusy !== null}
            onClick={() => void handleExtractTodos()}
          >
            {aiBusy === "todo" ? (
              <Loader2 size={14} aria-hidden="true" className="spin" />
            ) : (
              <CheckSquare size={14} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            type="button"
            size="1"
            variant="soft"
            data-testid={`tag-note-${note.id}`}
            title="Geminiでこのノートにタグとタイトルを付ける"
            disabled={aiBusy !== null}
            onClick={() => void handleTagThisNote()}
          >
            {aiBusy === "tag" ? (
              <Loader2 size={14} aria-hidden="true" className="spin" />
            ) : (
              <Tag size={14} aria-hidden="true" />
            )}
          </IconButton>
          <IconButton
            type="button"
            size="1"
            variant="soft"
            data-testid={`copy-note-${note.id}`}
            title="このノートの本文をクリップボードにコピーする"
            onClick={() => void handleCopy()}
          >
            <Copy size={14} aria-hidden="true" />
          </IconButton>
          {/* 初期化: ノートは残したまま中身(本文/タグ/対応済み)を空へ戻す。削除とは別物。 */}
          <IconButton
            type="button"
            size="1"
            variant="soft"
            data-testid={`reset-note-${note.id}`}
            title="このノートの内容を初期化する(空に戻す。ノート自体は残る)"
            onClick={() => {
              onNotesChange((prev) =>
                updateNote(prev, note.id, {
                  content: "",
                  tags: [],
                  done: false,
                  taggedHash: undefined,
                  junk: undefined,
                  updatedAt: clockNow(),
                }),
              );
              // Notepad(CM6)はcontentをマウント時しか読まないため、復元と同様に
              // restoreCounterを進めて再マウントし、空になった本文を画面へ反映する。
              setRestoreCounter((c) => c + 1);
            }}
          >
            <Eraser size={14} aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            size="1"
            variant="soft"
            color="red"
            data-testid={`delete-note-${note.id}`}
            title="このノートを削除する(スター済みならスペシャルへ凍結して残す)"
            onClick={() => onDeleteNote(note.id)}
          >
            <Trash2 size={14} aria-hidden="true" />
          </IconButton>
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
              <Badge key={tag} color="blue" variant="soft">
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
