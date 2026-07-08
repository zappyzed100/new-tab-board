// exportImport.ts — 全データ(ブックマーク・設定・ノート)のJSON書き出し/取り込み(純関数。SPEC.md §4.7)
//
// 履歴(スナップショット)はIndexedDBの大きなgzip blobであり、NAS向け手動フォルダ
// エクスポート(fileSystem.ts)の役割と重なるため、このJSONスナップショットには含めない。
import type { AppLaunch, Bookmark, Note, Settings } from "../types";

export const EXPORT_VERSION = 1;

export type ExportPayload = {
  version: number;
  exportedAt: number;
  bookmarks: Bookmark[];
  appLaunches: AppLaunch[];
  settings: Settings;
  notes: Note[];
};

export function buildExportPayload(
  sync: { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings },
  notes: Note[],
  now: number,
): ExportPayload {
  return {
    version: EXPORT_VERSION,
    exportedAt: now,
    bookmarks: sync.bookmarks,
    appLaunches: sync.appLaunches,
    settings: sync.settings,
    notes,
  };
}

export function serializeExport(payload: ExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

function isExportPayload(value: unknown): value is ExportPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "number" &&
    Array.isArray(v.bookmarks) &&
    Array.isArray(v.appLaunches) &&
    Array.isArray(v.notes) &&
    typeof v.settings === "object" &&
    v.settings !== null
  );
}

/** JSON文字列を検証しつつ読み込む。壊れたJSON/想定外の形はnullを返す(呼び出し側でエラー表示)。 */
export function parseImportPayload(json: string): ExportPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return isExportPayload(parsed) ? parsed : null;
}
