// Notepad.tsx — CodeMirror 6ベースの素マークダウンエディタ(SPEC.md §2・§4.2)
//
// ノート切替時は呼び出し側が key={noteId} を指定して本コンポーネントを再マウントする設計
// (CM6のEditorStateとReactのcontentプロパティを双方向同期する複雑さを避けるため)。
import { useEffect, useRef, useState } from "react";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, keymap, type Command } from "@codemirror/view";
import {
  copyLineDown,
  copyLineUp,
  defaultKeymap,
  deleteLine,
  history,
  historyKeymap,
  moveLineDown,
  moveLineUp,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { selectNextOccurrence } from "@codemirror/search";
import { evaluateLineIfCalculator } from "../../../lib/linking/calculator";

const EDITOR_MIN_HEIGHT_PX = 320;
// 画面へ入る少し前にCM6を準備する。全ノート分を常駐させると、各EditorViewの描画層が
// GPUプロセスへ累積し、BraveのHangWatcherがGPU入力スレッドの停止を検出した実害がある。
// **外側の窓化(ViewportNote.VIEWPORT_MARGIN_PX)より広くしておくこと**(2026-07-30)。
// 狭いと「セルはマウント済みなのに中のCM6だけdeferred」という帯ができ、そのペインは
// EDITOR_MIN_HEIGHT_PXまで潰れる——盤面はそのノートの見積もり高さぶんの場所を空けているので、
// 差(長文ノートでは1万px級)がそのまま「実体のない隙間=真っ黒な領域」として残る
// (2026-07-29から残っていた「上スクロール中の真っ黒」の残り。2026-07-30に実測で特定:
// mounted状態のセルが高さ450pxのまま、次のセルまで9,526px空いていた)。
const EDITOR_VIEWPORT_MARGIN_PX = 900;

type Props = {
  content: string;
  onContentChange: (content: string) => void;
  /** trueならマウント時にエディタへフォーカスする(既定true)。新規タブを開いた直後の
   * 自動選択では、代わりにオムニバーへフォーカスさせたいためApp.tsx側でfalseを渡す。 */
  autoFocus?: boolean;
  /** CM6のフォーカス取得/喪失。呼び出し側(NoteEditorPane)が編集シームの編集レジストリへ
   * 登録/解除し、フォーカス中のノートを同期の巻き戻し/削除/再マウントから守るのに使う。 */
  onFocus?: () => void;
  onBlur?: () => void;
  /** 画像の貼り付け/ドロップ(ユーザー指示・2026-07-23)。保存先はNASのみで、成功したら
   * 本文へ挿入する参照テキストを返す。NAS未登録などで保存できなければnull(何も挿入しない)。 */
  onAttachImage?: (blob: Blob) => Promise<string | null>;
  /** trueならペイン幅で折り返す(EditorView.lineWrapping)。falseはCM6既定の横スクロール。 */
  wrapLines?: boolean;
};

/** DataTransfer から画像を取り出す(貼り付け・ドロップ共通)。画像が無ければ空配列。 */
function imageBlobsFrom(data: DataTransfer | null): Blob[] {
  if (!data) return [];
  const blobs: Blob[] = [];
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) blobs.push(file);
    }
  }
  return blobs;
}

// インライン電卓(SPEC.md §7 v1確定): 行末が`= `で終わる算術式で改行すると、
// その場で結果を追記する。既定のEnter(改行挿入)より先に試し、該当しなければ
// falseを返して通常のEnterへフォールスルーする。
const calculatorEnter: Command = (view) => {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  if (pos !== line.to) return false;
  const evaluated = evaluateLineIfCalculator(line.text);
  if (!evaluated) return false;
  const insertText = ` ${evaluated.result}\n`;
  view.dispatch({
    changes: { from: line.to, insert: insertText },
    selection: EditorSelection.cursor(line.to + insertText.length),
  });
  return true;
};

// VSCode等でよく使われるテキスト編集ショートカット(SPEC.md §4.6の対象外——
// エディタ内部のCM6キーマップとして直接バインドする。アプリ全体の
// SHORTCUT_REGISTRY(useGlobalShortcuts.ts)とは別経路だが、`?`のチートシートには
// shortcuts.tsのEDITOR_SHORTCUTSとして併記する——両方を1箇所ずつ更新すること)。
const editingKeymap = [
  { key: "Alt-ArrowUp", run: moveLineUp },
  { key: "Alt-ArrowDown", run: moveLineDown },
  { key: "Shift-Alt-ArrowUp", run: copyLineUp },
  { key: "Shift-Alt-ArrowDown", run: copyLineDown },
  { key: "Mod-Shift-k", run: deleteLine },
  { key: "Mod-d", run: selectNextOccurrence },
];

// 行/列(メモ帳風)+カーソル位置(文書先頭からの絶対文字数)/全文字数の両方を表示する。
type CursorInfo = { line: number; col: number; pos: number; length: number };

export function Notepad({
  content,
  onContentChange,
  autoFocus = true,
  onFocus,
  onBlur,
  onAttachImage,
  wrapLines = false,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 折り返しの切替は Compartment で**再構成**する(再マウントしない)。key を変えて作り直すと
  // 表示中の全ノートのEditorViewが破棄され、入力中のカーソル/選択とundo履歴が消える——
  // 表示設定のトグル1回でそれを起こすのは割に合わない(notes/CLAUDE.md の再マウント事故と同根)。
  const wrapCompartment = useRef(new Compartment());
  const viewRef = useRef<EditorView | null>(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const onAttachImageRef = useRef(onAttachImage);
  onAttachImageRef.current = onAttachImage;

  /** 画像があれば既定動作を止め、NASへ保存してからカーソル位置へ参照を挿入する。
   * 画像が無い/添付口が無い場合は false を返して通常の貼り付け・ドロップへ委ねる。 */
  function attachImages(view: EditorView, blobs: Blob[], event: Event): boolean {
    const attach = onAttachImageRef.current;
    if (blobs.length === 0 || !attach) return false;
    event.preventDefault();
    void (async () => {
      for (const blob of blobs) {
        const reference = await attach(blob);
        if (reference === null) continue; // NAS未登録などで保存できなかった。本文は汚さない
        // 保存の待ち時間中にカーソルが動いている可能性があるため、その時点の位置へ入れる。
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        const prefix = line.text.slice(0, pos - line.from).trim() === "" ? "" : "\n";
        view.dispatch({
          changes: { from: pos, insert: `${prefix}${reference}\n` },
          selection: { anchor: pos + prefix.length + reference.length + 1 },
        });
      }
    })();
    return true;
  }
  // マウント時クロージャのCM6ハンドラが最新のfocus/blurコールバックを読むための鏡。
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  const onBlurRef = useRef(onBlur);
  onBlurRef.current = onBlur;
  // IntersectionObserverが無いテスト/旧ブラウザでは従来どおり即マウントして機能を落とさない。
  const [editorMounted, setEditorMounted] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  // 画面外へ出たEditorViewを破棄する前に実高さを保存し、プレースホルダへ引き継ぐ。
  // これが無いと破棄のたびにmasonryの高さが縮み、列の再配置とスクロールジャンプが起きる。
  const [placeholderHeight, setPlaceholderHeight] = useState(EDITOR_MIN_HEIGHT_PX);
  const [cursor, setCursor] = useState<CursorInfo>({
    line: 1,
    col: 1,
    pos: 0,
    length: content.length,
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof IntersectionObserver === "undefined") {
      setEditorMounted(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (!entry.isIntersecting && containerRef.current) {
          setPlaceholderHeight(
            Math.max(EDITOR_MIN_HEIGHT_PX, containerRef.current.getBoundingClientRect().height),
          );
        }
        setEditorMounted(entry.isIntersecting);
      },
      { rootMargin: `${EDITOR_VIEWPORT_MARGIN_PX}px 0px` },
    );
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editorMounted || !containerRef.current) return;
    function readCursor(state: EditorState): CursorInfo {
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      return { line: line.number, col: pos - line.from + 1, pos, length: state.doc.length };
    }
    const editState = EditorState.create({
      doc: content,
      extensions: [
        history(),
        // ネイティブブラウザキャレットはブラウザ間で挙動が不安定(位置追従が乱れる・
        // caret-colorがテーマ色に連動しない)ため、CM6自前描画のカーソル/選択に
        // 切り替える(見た目は.cm-cursorをstyles/components.cssでテーマ連動色に上書きしている)。
        drawSelection(),
        keymap.of([
          { key: "Enter", run: calculatorEnter },
          ...editingKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        markdown(),
        // 初期値だけここで決める。以降の切替は下のeffectがreconfigureで差し替える。
        wrapCompartment.current.of(wrapLines ? EditorView.lineWrapping : []),
        // 他のノート(や他の要素)を触ってフォーカスが外れたら、選択を解除してカーソルへ畳む
        // (ユーザー指示)。drawSelection()の選択ハイライトはblurしても残り続けるため明示的に消す。
        EditorView.domEventHandlers({
          // 画像の貼り付け/ドロップは、そのノートへの添付として扱う(ユーザー指示)。
          // CM6の既定はバイナリを無視して何も起きないため、こちらで奪って非同期に処理する。
          paste: (event, view) => attachImages(view, imageBlobsFrom(event.clipboardData), event),
          drop: (event, view) => attachImages(view, imageBlobsFrom(event.dataTransfer), event),
          // dropを受けるにはdragoverでの既定動作の打ち消しが要る(ブラウザのファイル表示を防ぐ)。
          dragover: (event) => {
            if (imageBlobsFrom(event.dataTransfer).length === 0) return false;
            event.preventDefault();
            return true;
          },
          focus: () => {
            onFocusRef.current?.();
            return false;
          },
          blur: (_event, view) => {
            if (!view.state.selection.main.empty) {
              view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.head) });
            }
            onBlurRef.current?.();
            return false;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onContentChangeRef.current(update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet) {
            setCursor(readCursor(update.state));
          }
        }),
      ],
    });
    const view = new EditorView({ state: editState, parent: containerRef.current });
    viewRef.current = view;
    setCursor(readCursor(editState));
    // ノート切替(key propによる再マウント)のたびに即フォーカスし、選択の1クリックで
    // すぐ入力できるようにする(フォーカスが無いと本文クリックがもう1回要る——実害あり)。
    // ただし新規タブを開いた直後の自動選択ではオムニバー側にフォーカスさせたいので、
    // 呼び出し側がautoFocus=falseを渡した時だけ奪わない。
    if (autoFocus) view.focus();
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // content/onContentChangeは初回マウント時のみ使用する(意図的な依存配列省略——
    // ノート切替時はkey prop、画面外から戻った時はeditorMountedで再マウントされる)。
  }, [editorMounted]);

  // 折り返し設定の切替を、生きているEditorViewへ再構成で流し込む(本文もカーソルも触らない)。
  // マウント直後は初期値と同じ内容の再構成になるが、docChanged/selectionSetのどちらも立たない
  // ため onContentChange も発火しない(無害な冪等dispatch)。
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrapLines ? EditorView.lineWrapping : []),
    });
  }, [wrapLines, editorMounted]);

  return (
    <div
      ref={viewportRef}
      data-testid="notepad-viewport"
      data-editor-state={editorMounted ? "mounted" : "deferred"}
    >
      {editorMounted ? (
        <div data-testid="notepad-editor" ref={containerRef} />
      ) : (
        <div
          data-testid="notepad-editor-placeholder"
          aria-hidden="true"
          style={{ height: `${placeholderHeight}px` }}
        />
      )}
      <div data-testid="notepad-status-bar">
        行 {cursor.line}、列 {cursor.col}、{cursor.pos}文字/全{cursor.length}文字
      </div>
    </div>
  );
}
