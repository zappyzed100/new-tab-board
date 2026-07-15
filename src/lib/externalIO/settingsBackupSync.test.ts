// settingsBackupSync.test.ts — settingsBackupSync.ts(NASの設定バックアップ書き出し/読み戻し)の単体テスト
import { describe, expect, it, vi } from "vitest";
import {
  pullSettingsBackupFromNas,
  pushSettingsBackupToNas,
  SETTINGS_BACKUP_FILENAME,
} from "./settingsBackupSync";
import { buildSettingsBackupPayload, serializeSettingsBackup } from "../fileio/settingsBackup";
import type { Settings } from "../../types";

const settings: Settings = { openIn: "same", theme: "dark", searchEngine: "https://x/?q=%s" };
const sync = { bookmarks: [], appLaunches: [], settings };
const payload = buildSettingsBackupPayload(
  sync,
  { todos: [], specialItems: [], specialFolders: [] },
  1000,
);
const json = serializeSettingsBackup(payload);

describe("pushSettingsBackupToNas", () => {
  it("NAS設定済みならdata/settings-backup.jsonへ書く", async () => {
    const writeFileToNas = vi.fn().mockResolvedValue(true);
    const ok = await pushSettingsBackupToNas(json, {
      getNasFolderPath: async () => "Z:\\NAS",
      writeFileToNas,
    });
    expect(ok).toBe(true);
    expect(writeFileToNas).toHaveBeenCalledWith("Z:\\NAS", SETTINGS_BACKUP_FILENAME, json);
  });

  it("NAS未設定なら書き込まずfalse", async () => {
    const writeFileToNas = vi.fn();
    const ok = await pushSettingsBackupToNas(json, {
      getNasFolderPath: async () => undefined,
      writeFileToNas,
    });
    expect(ok).toBe(false);
    expect(writeFileToNas).not.toHaveBeenCalled();
  });
});

describe("pullSettingsBackupFromNas", () => {
  it("読み戻してパースした内容を返す", async () => {
    const readFileFromNas = vi.fn().mockResolvedValue(json);
    const result = await pullSettingsBackupFromNas({
      getNasFolderPath: async () => "Z:\\NAS",
      readFileFromNas,
    });
    expect(result).toEqual(payload);
    expect(readFileFromNas).toHaveBeenCalledWith("Z:\\NAS", SETTINGS_BACKUP_FILENAME);
  });

  it("NAS未設定はnull", async () => {
    const result = await pullSettingsBackupFromNas({ getNasFolderPath: async () => undefined });
    expect(result).toBeNull();
  });

  it("ファイル未作成(null)はnull", async () => {
    const result = await pullSettingsBackupFromNas({
      getNasFolderPath: async () => "Z:\\NAS",
      readFileFromNas: vi.fn().mockResolvedValue(null),
    });
    expect(result).toBeNull();
  });

  it("壊れたJSONはnull", async () => {
    const result = await pullSettingsBackupFromNas({
      getNasFolderPath: async () => "Z:\\NAS",
      readFileFromNas: vi.fn().mockResolvedValue("{not valid"),
    });
    expect(result).toBeNull();
  });
});
