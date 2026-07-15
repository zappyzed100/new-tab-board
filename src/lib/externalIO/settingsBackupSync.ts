// settingsBackupSync.ts — 全体設定バックアップ(テーマ/TODO/ブックマーク/ノート文字サイズ/
// スペシャル/タグ候補。notesは含まない)をNASの data/settings-backup.json へ書き出し・
// 読み戻す(ユーザー指示: これらもNASに保存し、NASからも復元できるように)。
import { readFileFromNas, writeFileToNas } from "./nasNativeHost";
import { getNasFolderPath } from "../storage/db";
import { parseSettingsBackupPayload, type SettingsBackupPayload } from "../fileio/settingsBackup";

export const SETTINGS_BACKUP_FILENAME = "data/settings-backup.json";

export type SettingsBackupNasDeps = {
  getNasFolderPath?: () => Promise<string | undefined>;
  writeFileToNas?: typeof writeFileToNas;
  readFileFromNas?: typeof readFileFromNas;
};

/** 設定バックアップJSONをNASへ書く。NAS未設定/書き込み失敗はfalse。 */
export async function pushSettingsBackupToNas(
  json: string,
  deps: SettingsBackupNasDeps = {},
): Promise<boolean> {
  const path = await (deps.getNasFolderPath ?? getNasFolderPath)();
  if (!path) return false;
  const _write = deps.writeFileToNas ?? writeFileToNas;
  return _write(path, SETTINGS_BACKUP_FILENAME, json);
}

/** NASから設定バックアップを読み戻す。NAS未設定/未作成/壊れたJSONはnull。 */
export async function pullSettingsBackupFromNas(
  deps: SettingsBackupNasDeps = {},
): Promise<SettingsBackupPayload | null> {
  const path = await (deps.getNasFolderPath ?? getNasFolderPath)();
  if (!path) return null;
  const _read = deps.readFileFromNas ?? readFileFromNas;
  const json = await _read(path, SETTINGS_BACKUP_FILENAME);
  if (json === null) return null;
  return parseSettingsBackupPayload(json);
}
