// useSnapshotScheduler.ts — 編集区切りシグナル(アイドル/blur/visibilitychange/pagehide/paste/
// 変更量閾値/最長キャップ)をhistory.tsの判定関数へ配線し、gzip圧縮してdb.tsへ保存する(SPEC.md §4.3)。
import { useEffect, useRef } from "react";
import { now as clockNow } from "./clock";
import { putSnapshot } from "./db";
import { gzipCompress } from "./gzip";
import { exceedsChangeThreshold, exceedsMaxCap, shouldSnapshot } from "./history";
import { logOp } from "./log";
import { indexSnapshot } from "./search";

const IDLE_MS = 2_500;
const MAX_CAP_CHECK_INTERVAL_MS = 5_000;

/** Cmd/Ctrl+S(即時スナップショット保存。SPEC.md §6)から呼ぶ、無条件で1件保存する関数。 */
export async function forceSnapshot(noteId: string, content: string): Promise<void> {
  const compressed = await gzipCompress(content);
  const snapshotId = crypto.randomUUID();
  await putSnapshot({ id: snapshotId, noteId, timestamp: clockNow(), content: compressed });
  await indexSnapshot(snapshotId, content);
  logOp("history", "snapshot", `note=${noteId} reason=manual`);
}

export function useSnapshotScheduler(noteId: string, content: string): void {
  const lastSnapshotAtRef = useRef<number | null>(null);
  const lastContentRef = useRef<string | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  async function snapshotIfNeeded(reason: string) {
    const now = clockNow();
    const currentContent = contentRef.current;
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
    await putSnapshot({ id: snapshotId, noteId, timestamp: now, content: compressed });
    await indexSnapshot(snapshotId, currentContent);
    logOp("history", "snapshot", `note=${noteId} reason=${reason}`);
    lastSnapshotAtRef.current = now;
    lastContentRef.current = currentContent;
  }

  // アイドル(入力停止2.5秒) + 変更量閾値の即時チェック
  useEffect(() => {
    const timer = setTimeout(() => void snapshotIfNeeded("idle"), IDLE_MS);
    if (exceedsChangeThreshold(lastContentRef.current, content)) {
      void snapshotIfNeeded("threshold");
    }
    return () => clearTimeout(timer);
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
