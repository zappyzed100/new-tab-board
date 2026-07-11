// useJsonBackupSync.ts — 全データJSONバックアップをdebounceしてDrive同期をキックするReact hook
// (SPEC.md §4.7)。useDriveSync.ts(ノート現行内容の自動同期)と同じ設計・同じdebounce間隔。
import { useEffect, useRef, useState } from "react";
import { now as clockNow } from "../runtime/clock";
import { syncJsonBackupToDrive } from "./jsonBackupSync";

export type JsonBackupSyncStatus = "idle" | "syncing" | "synced" | "unauthenticated" | "error";

const DEBOUNCE_MS = 3_000;

export function useJsonBackupSync(
  json: string | null,
  knownFileId: string | undefined,
  onSynced: (fileId: string, syncedAt: number) => void,
): { status: JsonBackupSyncStatus } {
  const [status, setStatus] = useState<JsonBackupSyncStatus>("idle");
  const jsonRef = useRef(json);
  jsonRef.current = json;
  const fileIdRef = useRef(knownFileId);
  fileIdRef.current = knownFileId;
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  useEffect(() => {
    if (!json) return;
    const timer = setTimeout(() => {
      void (async () => {
        setStatus("syncing");
        const result = await syncJsonBackupToDrive(
          jsonRef.current ?? "",
          clockNow(),
          false,
          fileIdRef.current,
        );
        if (result.status === "synced") {
          setStatus("synced");
          onSyncedRef.current(result.fileId, result.syncedAt);
        } else {
          setStatus(result.status);
        }
      })();
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // jsonの変化(=bookmarks/notes/settings/todosいずれかの変更)だけで再発火させる
    // 意図的な依存配列(useDriveSync.tsと同じ流儀)。
  }, [json]);

  return { status };
}
