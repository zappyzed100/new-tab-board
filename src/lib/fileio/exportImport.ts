// exportImport.ts — 全データ(ブックマーク・設定・ノート・TODO・スペシャル)のJSON書き出し/
// 取り込み(純関数。SPEC.md §4.7)。
//
// 履歴(スナップショット)はIndexedDBの大きなgzip blobであり、NAS向け手動フォルダ
// エクスポート(fileSystem.ts)の役割と重なるため、このJSONスナップショットには含めない。
//
// todos/specialItems/specialFoldersは元々このpayloadに含まれておらず、Driveへの退避/復元で
// 静かに欠落していた(ユーザー指摘: TODOリスト・スペシャルもDriveに保存/復元できるように)。
// theme/noteFontSize/tagCandidatesはSettingsの一部として元から含まれている。
import type { AppLaunch, Bookmark, Note, Settings, SpecialItem, Todo } from "../../types";

export const EXPORT_VERSION = 1;

export type ExportPayload = {
  version: number;
  exportedAt: number;
  bookmarks: Bookmark[];
  appLaunches: AppLaunch[];
  settings: Settings;
  notes: Note[];
  todos: Todo[];
  specialItems: SpecialItem[];
  specialFolders: string[];
};

export function buildExportPayload(
  sync: { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings },
  extra: { notes: Note[]; todos: Todo[]; specialItems: SpecialItem[]; specialFolders: string[] },
  now: number,
): ExportPayload {
  return {
    version: EXPORT_VERSION,
    exportedAt: now,
    bookmarks: sync.bookmarks,
    appLaunches: sync.appLaunches,
    settings: sync.settings,
    notes: extra.notes,
    todos: extra.todos,
    specialItems: extra.specialItems,
    specialFolders: extra.specialFolders,
  };
}

export function serializeExport(payload: ExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

/** todos/specialItems/specialFoldersを追加する前の旧バックアップにも一致する最小要件
 * (この3フィールドは無ければ空配列で補う——後方互換。下のparseImportPayload参照)。 */
function isExportPayloadBase(value: unknown): value is Record<string, unknown> {
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

/** JSON文字列を検証しつつ読み込む。壊れたJSON/想定外の形はnullを返す(呼び出し側でエラー表示)。
 * todos/specialItems/specialFoldersが追加される前の旧バックアップも読める(無ければ空配列)。 */
export function parseImportPayload(json: string): ExportPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isExportPayloadBase(parsed)) return null;
  return {
    ...(parsed as Omit<ExportPayload, "todos" | "specialItems" | "specialFolders">),
    todos: Array.isArray(parsed.todos) ? (parsed.todos as Todo[]) : [],
    specialItems: Array.isArray(parsed.specialItems) ? (parsed.specialItems as SpecialItem[]) : [],
    specialFolders: Array.isArray(parsed.specialFolders) ? (parsed.specialFolders as string[]) : [],
  };
}
