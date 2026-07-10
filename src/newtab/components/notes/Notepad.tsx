// Notepad.tsx — CodeMirror 6ベースの素マークダウンエディタ(SPEC.md §2・§4.2)
//
// ノート切替時は呼び出し側が key={noteId} を指定して本コンポーネントを再マウントする設計
// (CM6のEditorStateとReactのcontentプロパティを双方向同期する複雑さを避けるため)。
import { useEffect, useRef, useState } from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, type Command } from "@codemirror/view";
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

type Props = {
  content: string;
  onContentChange: (content: string) => void;
};

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

type CursorInfo = { line: number; col: number; length: number };

export function Notepad({ content, onContentChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;
  const [cursor, setCursor] = useState<CursorInfo>(() => {
    const nlIndex = content.length; // 初期表示は先頭(1行目・1列目)扱いで十分
    return { line: 1, col: 1, length: nlIndex };
  });

  useEffect(() => {
    if (!containerRef.current) return;
    function readCursor(state: EditorState): CursorInfo {
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      return { line: line.number, col: pos - line.from + 1, length: state.doc.length };
    }
    const editState = EditorState.create({
      doc: content,
      extensions: [
        history(),
        keymap.of([
          { key: "Enter", run: calculatorEnter },
          ...editingKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        markdown(),
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
    setCursor(readCursor(editState));
    // ノート切替(key propによる再マウント)のたびに即フォーカスし、選択の1クリックで
    // すぐ入力できるようにする(フォーカスが無いと本文クリックがもう1回要る——実害あり)。
    view.focus();
    return () => view.destroy();
    // content/onContentChangeは初回マウント時のみ使用する(意図的な依存配列省略——
    // ノート切替時はkey propで再マウントされるため、ここでの再実行は不要)。
  }, []);

  return (
    <div>
      <div data-testid="notepad-editor" ref={containerRef} />
      <div data-testid="notepad-status-bar">
        行 {cursor.line}、列 {cursor.col} ・ {cursor.length}文字
      </div>
    </div>
  );
}
