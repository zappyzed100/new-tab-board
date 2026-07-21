// useDriveSync.ts — ノート編集をdebounceしてDrive同期をキックするReact hook(SPEC.md §4.2)
import { useEffect, useRef, useState } from "react";
import { now as clockNow } from "../runtime/clock";
import { syncNoteToDrive } from "./driveSync";
import type { Note } from "../../types";

export type DriveSyncStatus = "idle" | "syncing" | "synced" | "unauthenticated" | "error";

// 自動同期の5分周期はbackground service workerのdrive-note-syncへ集約する。このhookは
// ペインの状態表示とCmd/Ctrl+Sによる明示同期だけを担当し、タブ数だけ通信が増えるのを防ぐ。

export function useDriveSync(
  note: Note | null,
  onSynced: (driveFileId: string, lastSyncedAt: number) => void,
): { status: DriveSyncStatus; syncNow: (interactive: boolean) => void } {
  const [status, setStatus] = useState<DriveSyncStatus>("idle");
  const noteRef = useRef(note);
  noteRef.current = note;
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  async function runSync(interactive: boolean) {
    const current = noteRef.current;
    if (!current) return;
    setStatus("syncing");
    const result = await syncNoteToDrive(current, clockNow(), interactive);
    if (result.status === "synced") {
      setStatus("synced");
      onSyncedRef.current(result.driveFileId, result.lastSyncedAt);
    } else if (result.status === "skipped-empty") {
      // 空ノートは上げない(ユーザー指示)。同期状態としてはidle(バッジを出さない)。
      setStatus("idle");
    } else {
      setStatus(result.status);
    }
  }

  useEffect(() => {
    if (note?.lastSyncedAt) setStatus("synced");
  }, [note?.lastSyncedAt]);

  return { status, syncNow: (interactive: boolean) => void runSync(interactive) };
}
