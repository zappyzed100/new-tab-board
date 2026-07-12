// useSnapshotScheduler.ts — 編集区切りシグナル(アイドル/blur/visibilitychange/pagehide/paste/
// 変更量閾値/最長キャップ)をhistory.tsの判定関数へ配線し、gzip圧縮してdb.tsへ保存する(SPEC.md §4.3)。
import { useEffect, useRef } from "react";
import { now as clockNow } from "../runtime/clock";
import { putSnapshot } from "../storage/db";
import { gzipCompress } from "./gzip";
import {
  exceedsChangeThreshold,
  exceedsMaxCap,
  isLargeDeletion,
  shouldSnapshot,
  summarizeSnapshot,
} from "./history";
import { logOp } from "../runtime/log";
import { indexSnapshot } from "../search/search";

// アイドル保存の間隔。「5分放置されたら保存」(ユーザー指示——頻繁すぎる自動保存を抑える)。
const IDLE_MS = 300_000;
// 最長キャップの判定を回す間隔(実際に刻むのはexceedsMaxCap成立時のみ)。キャップ自体が
// 5分なので、5秒ごとに細かく確認する必要はなく30秒間隔で十分。
const MAX_CAP_CHECK_INTERVAL_MS = 30_000;

/** Cmd/Ctrl+S(即時スナップショット保存。SPEC.md §6)から呼ぶ、無条件で1件保存する関数。 */
export async function forceSnapshot(noteId: string, content: string): Promise<void> {
  if (content.trim() === "") return; // 空ノートは保存対象にしない(ユーザー指示)
  const compressed = await gzipCompress(content);
  const snapshotId = crypto.randomUUID();
  await putSnapshot({
    id: snapshotId,
    noteId,
    timestamp: clockNow(),
    content: compressed,
    archived: false,
    summary: summarizeSnapshot(content, null),
  });
  await indexSnapshot(snapshotId, content);
  logOp("history", "snapshot", `note=${noteId} reason=manual`);
}

export function useSnapshotScheduler(noteId: string, content: string): void {
  const lastSnapshotAtRef = useRef<number | null>(null);
  const lastContentRef = useRef<string | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  async function snapshotIfNeeded(reason: string, contentToSnapshot?: string) {
    const now = clockNow();
    // 通常は現在の本文を刻むが、大量削除時は「消える前」の内容を明示的に渡して守る。
    const currentContent = contentToSnapshot ?? contentRef.current;
    if (
      !shouldSnapshot({
        now,
        lastSnapshotAt: lastSnapshotAtRef.current,
        lastContent: lastContentRef.current,
        currentContent,
      })
    ) {
      return;
    }
    const compressed = await gzipCompress(currentContent);
    const snapshotId = crypto.randomUUID();
    await putSnapshot({
      id: snapshotId,
      noteId,
      timestamp: now,
      content: compressed,
      archived: false,
      summary: summarizeSnapshot(currentContent, lastContentRef.current),
    });
    await indexSnapshot(snapshotId, currentContent);
    logOp("history", "snapshot", `note=${noteId} reason=${reason}`);
    lastSnapshotAtRef.current = now;
    lastContentRef.current = currentContent;
  }

  // アイドル(入力停止5分) + 変更量閾値の即時チェック
  useEffect(() => {
    const timer = setTimeout(() => void snapshotIfNeeded("idle"), IDLE_MS);
    if (exceedsChangeThreshold(lastContentRef.current, content)) {
      void snapshotIfNeeded("threshold");
    }
    return () => clearTimeout(timer);
  }, [content, noteId]);

  // 全選択からの削除(非空→空)等の大量削除は、消える前の内容を即座に刻んで守る
  // (アイドル保存を5分に延ばしたため、削除で直近の内容が履歴から失われないように——ユーザー指示)。
  const prevContentRef = useRef(content);
  const lastNoteIdRef = useRef(noteId);
  useEffect(() => {
    if (lastNoteIdRef.current !== noteId) {
      // ノート切替(通常はkey=note.idで再マウントされ起きないが念のため):
      // 前ノートの内容を今ノートの削除と誤検知しないようリセットする。
      lastNoteIdRef.current = noteId;
      prevContentRef.current = content;
      return;
    }
    const prev = prevContentRef.current;
    prevContentRef.current = content;
    if (isLargeDeletion(prev, content)) {
      void snapshotIfNeeded("large-deletion", prev);
    }
  }, [content, noteId]);

  // フォーカス喪失・タブ非表示・離脱
  useEffect(() => {
    function onBlurOrHide() {
      void snapshotIfNeeded("blur-or-hide");
    }
    window.addEventListener("blur", onBlurOrHide);
    document.addEventListener("visibilitychange", onBlurOrHide);
    window.addEventListener("pagehide", onBlurOrHide);
    return () => {
      window.removeEventListener("blur", onBlurOrHide);
      document.removeEventListener("visibilitychange", onBlurOrHide);
      window.removeEventListener("pagehide", onBlurOrHide);
    };
  }, []);

  // ペースト(離散的な大きな変化)
  useEffect(() => {
    function onPaste() {
      void snapshotIfNeeded("paste");
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // 最長キャップ: アクティブ編集中でも最低頻度で強制的に刻む安全網
  useEffect(() => {
    const interval = setInterval(() => {
      if (exceedsMaxCap(clockNow(), lastSnapshotAtRef.current)) {
        void snapshotIfNeeded("max-cap");
      }
    }, MAX_CAP_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}
