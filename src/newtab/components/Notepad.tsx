// Notepad.tsx — CodeMirror 6ベースの素マークダウンエディタ(SPEC.md §2・§4.2)
//
// ノート切替時は呼び出し側が key={noteId} を指定して本コンポーネントを再マウントする設計
// (CM6のEditorStateとReactのcontentプロパティを双方向同期する複雑さを避けるため)。
import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

type Props = {
  content: string;
  onContentChange: (content: string) => void;
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
        keymap.of([...defaultKeymap, ...historyKeymap]),
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
