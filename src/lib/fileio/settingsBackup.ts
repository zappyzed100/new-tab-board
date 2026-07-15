// settingsBackup.ts — ノート本文を除く全体設定(テーマ/TODO/ブックマーク/ノート文字サイズ/
// スペシャル/タグ候補)のJSON書き出し/取り込み(純関数)。notesはNAS/Driveのactive/日付
// フォルダで別途同期されているため、ここには含めない(ユーザー指示: これらもNASに保存し、
// NASからも復元できるように。特にTODOリストはactiveの同期サイクルに乗せてほしい)。
import type { AppLaunch, Bookmark, Settings, SpecialItem, Todo } from "../../types";

export const SETTINGS_BACKUP_VERSION = 1;

export type SettingsBackupPayload = {
  version: number;
  savedAt: number;
  bookmarks: Bookmark[];
  appLaunches: AppLaunch[];
  settings: Settings;
  todos: Todo[];
  specialItems: SpecialItem[];
  specialFolders: string[];
};

export function buildSettingsBackupPayload(
  sync: { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings },
  extra: { todos: Todo[]; specialItems: SpecialItem[]; specialFolders: string[] },
  now: number,
): SettingsBackupPayload {
  return {
    version: SETTINGS_BACKUP_VERSION,
    savedAt: now,
    bookmarks: sync.bookmarks,
    appLaunches: sync.appLaunches,
    settings: sync.settings,
    todos: extra.todos,
    specialItems: extra.specialItems,
    specialFolders: extra.specialFolders,
  };
}

export function serializeSettingsBackup(payload: SettingsBackupPayload): string {
  return JSON.stringify(payload, null, 2);
}

function isSettingsBackupPayload(value: unknown): value is SettingsBackupPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "number" &&
    Array.isArray(v.bookmarks) &&
    Array.isArray(v.appLaunches) &&
    Array.isArray(v.todos) &&
    Array.isArray(v.specialItems) &&
    Array.isArray(v.specialFolders) &&
    typeof v.settings === "object" &&
    v.settings !== null
  );
}

/** JSON文字列を検証しつつ読み込む。壊れたJSON/想定外の形はnullを返す(呼び出し側でエラー表示)。 */
export function parseSettingsBackupPayload(json: string): SettingsBackupPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return isSettingsBackupPayload(parsed) ? parsed : null;
}
