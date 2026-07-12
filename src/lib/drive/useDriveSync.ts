// useDriveSync.ts — ノート編集をdebounceしてDrive同期をキックするReact hook(SPEC.md §4.2)
import { useEffect, useRef, useState } from "react";
import { now as clockNow } from "../runtime/clock";
import { syncNoteToDrive } from "./driveSync";
import type { Note } from "../../types";

export type DriveSyncStatus = "idle" | "syncing" | "synced" | "unauthenticated" | "error";

// Drive の active/ 更新は「5分単位」(ユーザー指示)。編集が止まって5分でアップロードする
// (NAS active の保存タイミング・履歴スナップショットのアイドル5分と揃える)。Cmd/Ctrl+S の
// syncNow(interactive)は即時アップロードするため、明示保存はこのdebounceを待たない。
const DEBOUNCE_MS = 300_000;

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
    if (!note) return;
    const timer = setTimeout(() => void runSync(false), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // note.content/idの変化だけで再発火させる意図的な依存配列(§9.2の流儀。runSyncは常に
    // noteRef経由で最新値を読むため、runSync自体を依存に含める必要はない)。
  }, [note?.content, note?.id]);

  return { status, syncNow: (interactive: boolean) => void runSync(interactive) };
}
