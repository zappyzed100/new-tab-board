// settingsBackupSync.ts — 全体設定バックアップ(テーマ/TODO/ブックマーク/ノート文字サイズ/
// スペシャル/タグ候補。notesは含まない)をNASの data/settings-backup.json へ書き出し・
// 読み戻す(ユーザー指示: これらもNASに保存し、NASからも復元できるように)。
import { readFileFromNas, writeFileToNas } from "./nasNativeHost";
import { getNasFolderPath } from "../storage/db";
import { parseSettingsBackupPayload, type SettingsBackupPayload } from "../fileio/settingsBackup";
import { logOp } from "../runtime/log";

export const SETTINGS_BACKUP_FILENAME = "data/settings-backup.json";

export type SettingsBackupNasDeps = {
  getNasFolderPath?: () => Promise<string | undefined>;
  writeFileToNas?: typeof writeFileToNas;
  readFileFromNas?: typeof readFileFromNas;
};

function hasBookmarks(payload: SettingsBackupPayload | null): boolean {
  return (payload?.bookmarks.length ?? 0) > 0;
}

/** 設定バックアップJSONをNASへ書く。NAS未設定/書き込み失敗はfalse。
 * ローカルのブックマークが空になった状態で、NAS側に残る非空バックアップを無条件上書きして
 * しまう事故を防ぐガード付き(2026-07-18: jsonBackupSync.tsの同種ガードと対の実装。
 * chrome.storage.syncの8KB/item上限超過でブックマークが消えた実害を受けて追加)。 */
export async function pushSettingsBackupToNas(
  json: string,
  deps: SettingsBackupNasDeps = {},
): Promise<boolean> {
  const path = await (deps.getNasFolderPath ?? getNasFolderPath)();
  if (!path) return false;
  const _write = deps.writeFileToNas ?? writeFileToNas;
  const _read = deps.readFileFromNas ?? readFileFromNas;

  if (!hasBookmarks(parseSettingsBackupPayload(json))) {
    try {
      const existingJson = await _read(path, SETTINGS_BACKUP_FILENAME);
      const existing = existingJson ? parseSettingsBackupPayload(existingJson) : null;
      if (hasBookmarks(existing)) {
        logOp(
          "settingsBackupSync",
          "push-skipped-empty-guard",
          "local-bookmarks-empty-but-nas-has-bookmarks",
        );
        return false;
      }
    } catch (err) {
      logOp("settingsBackupSync", "push-guard-check-error", "既存バックアップの検証に失敗(続行)", {
        error: err,
      });
    }
  }

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
