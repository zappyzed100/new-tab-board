// useAutoTagScheduler.ts — 自動タグ付け/タイトル付けの起動条件(編集終了から5分 or 400文字変更)を
// history.tsのスナップショット判定(idle/blur/paste/大量削除/最長キャップ)とは切り離して持つ
// (ユーザー指示: 保存イベント全般に乗せるとblur等でも早すぎたため、この2条件のみに絞る)。
import { useEffect, useRef } from "react";
import { exceedsAutoTagChangeThreshold } from "./tagging";

/** 編集終了(=本文が変わらなくなって)からこの時間で起動する(ユーザー指示)。 */
const AUTO_TAG_IDLE_MS = 300_000;

export function useAutoTagScheduler(
  noteId: string,
  content: string,
  onTrigger: (content: string) => void,
): void {
  const lastContentRef = useRef(content);
  const lastNoteIdRef = useRef(noteId);
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;

  useEffect(() => {
    if (lastNoteIdRef.current !== noteId) {
      // ノート切替: 前ノートの内容を今ノートの変更量と誤検知しないようリセットする。
      lastNoteIdRef.current = noteId;
      lastContentRef.current = content;
      return;
    }
    if (exceedsAutoTagChangeThreshold(lastContentRef.current, content)) {
      lastContentRef.current = content;
      onTriggerRef.current(content);
    }
    const timer = setTimeout(() => {
      lastContentRef.current = content;
      onTriggerRef.current(content);
    }, AUTO_TAG_IDLE_MS);
    return () => clearTimeout(timer);
  }, [content, noteId]);
}
