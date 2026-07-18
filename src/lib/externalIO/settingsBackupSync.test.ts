// settingsBackupSync.test.ts — settingsBackupSync.ts(NASの設定バックアップ書き出し/読み戻し)の単体テスト
import { describe, expect, it, vi } from "vitest";
import {
  pullSettingsBackupFromNas,
  pushSettingsBackupToNas,
  SETTINGS_BACKUP_FILENAME,
} from "./settingsBackupSync";
import { buildSettingsBackupPayload, serializeSettingsBackup } from "../fileio/settingsBackup";
import type { Bookmark, Settings } from "../../types";

const settings: Settings = { openIn: "same", theme: "dark", searchEngine: "https://x/?q=%s" };
const sync = { bookmarks: [], appLaunches: [], settings };
const payload = buildSettingsBackupPayload(
  sync,
  { todos: [], specialItems: [], specialFolders: [] },
  1000,
);
const json = serializeSettingsBackup(payload);

const bookmark: Bookmark = {
  id: "b1",
  url: "https://example.com",
  label: "Example",
  icon: { type: "favicon" },
  order: 0,
};
const jsonWithBookmarks = serializeSettingsBackup(
  buildSettingsBackupPayload(
    { ...sync, bookmarks: [bookmark] },
    { todos: [], specialItems: [], specialFolders: [] },
    1000,
  ),
);

describe("pushSettingsBackupToNas", () => {
  it("NAS設定済みならdata/settings-backup.jsonへ書く", async () => {
    const writeFileToNas = vi.fn().mockResolvedValue(true);
    const ok = await pushSettingsBackupToNas(json, {
      getNasFolderPath: async () => "Z:\\NAS",
      writeFileToNas,
      readFileFromNas: vi.fn().mockResolvedValue(null),
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

  it(
    "ローカルのブックマークが空でも、NAS側の既存バックアップが空ならガードせず書く" +
      "(空同士の上書きは正常系)",
    async () => {
      const writeFileToNas = vi.fn().mockResolvedValue(true);
      const ok = await pushSettingsBackupToNas(json, {
        getNasFolderPath: async () => "Z:\\NAS",
        writeFileToNas,
        readFileFromNas: vi.fn().mockResolvedValue(json), // 既存も空
      });
      expect(ok).toBe(true);
      expect(writeFileToNas).toHaveBeenCalled();
    },
  );

  it(
    "ローカルのブックマークが空で、NAS側の既存バックアップに中身があれば書き込みを中止する" +
      "(2026-07-18: 空への無条件上書きでブックマークが消えた実害を受けた回帰テスト)",
    async () => {
      const writeFileToNas = vi.fn();
      const ok = await pushSettingsBackupToNas(json, {
        getNasFolderPath: async () => "Z:\\NAS",
        writeFileToNas,
        readFileFromNas: vi.fn().mockResolvedValue(jsonWithBookmarks), // 既存はブックマーク有り
      });
      expect(ok).toBe(false);
      expect(writeFileToNas).not.toHaveBeenCalled();
    },
  );

  it("ローカルにブックマークがあればガードを経由せず書く", async () => {
    const writeFileToNas = vi.fn().mockResolvedValue(true);
    const readFileFromNas = vi.fn();
    const ok = await pushSettingsBackupToNas(jsonWithBookmarks, {
      getNasFolderPath: async () => "Z:\\NAS",
      writeFileToNas,
      readFileFromNas,
    });
    expect(ok).toBe(true);
    expect(readFileFromNas).not.toHaveBeenCalled(); // 空でないので既存確認そのものが不要
    expect(writeFileToNas).toHaveBeenCalledWith(
      "Z:\\NAS",
      SETTINGS_BACKUP_FILENAME,
      jsonWithBookmarks,
    );
  });

  it("既存バックアップの検証(読み取り)が失敗しても、ガードのため同期を止めず書き込む", async () => {
    const writeFileToNas = vi.fn().mockResolvedValue(true);
    const ok = await pushSettingsBackupToNas(json, {
      getNasFolderPath: async () => "Z:\\NAS",
      writeFileToNas,
      readFileFromNas: vi.fn().mockRejectedValue(new Error("native host down")),
    });
    expect(ok).toBe(true);
    expect(writeFileToNas).toHaveBeenCalled();
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
