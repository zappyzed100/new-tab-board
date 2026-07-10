// Notepad.tsx — CodeMirror 6ベースの素マークダウンエディタ(SPEC.md §2・§4.2)
//
// ノート切替時は呼び出し側が key={noteId} を指定して本コンポーネントを再マウントする設計
// (CM6のEditorStateとReactのcontentプロパティを双方向同期する複雑さを避けるため)。
import { useEffect, useRef } from "react";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, type Command } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
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

export function Notepad({ content, onContentChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  useEffect(() => {
    if (!containerRef.current) return;
    const state = EditorState.create({
      doc: content,
      extensions: [
        history(),
        keymap.of([{ key: "Enter", run: calculatorEnter }, ...defaultKeymap, ...historyKeymap]),
        markdown(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onContentChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: containerRef.current });
    return () => view.destroy();
    // content/onContentChangeは初回マウント時のみ使用する(意図的な依存配列省略——
    // ノート切替時はkey propで再マウントされるため、ここでの再実行は不要)。
  }, []);

  return <div data-testid="notepad-editor" ref={containerRef} />;
}
