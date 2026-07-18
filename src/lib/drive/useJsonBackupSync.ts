// useJsonBackupSync.ts — 全データJSONバックアップをdebounceしてDrive同期をキックするReact hook
// (SPEC.md §4.7)。useDriveSync.ts(ノート現行内容の自動同期)と同じ設計・同じdebounce間隔。
import { useEffect, useRef, useState } from "react";
import { now as clockNow } from "../runtime/clock";
import { syncJsonBackupToDrive } from "./jsonBackupSync";

export type JsonBackupSyncStatus =
  "idle" | "syncing" | "synced" | "unauthenticated" | "skipped-empty-guard" | "error";

// 全データJSONバックアップの自動退避間隔。ユーザー指示「同期回数が多すぎる」を受け、編集/並べ替えの
// たびに全文を上げないよう5分へ(履歴スナップショット・Drive active と同じ節度)。並べ替えだけの
// 変更もこの5分窓へ吸収される。明示退避(データ管理の「☁️ Driveへ退避」)は即時なので待たされない。
const DEBOUNCE_MS = 300_000;

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
