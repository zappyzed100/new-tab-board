// jsonBackupSync.test.ts — jsonBackupSync.ts(全データJSONバックアップのDrive同期
// オーケストレーション)の単体テスト
import { describe, expect, it, vi } from "vitest";
import { restoreJsonBackupFromDrive, syncJsonBackupToDrive } from "./jsonBackupSync";

const json = '{"version":1,"bookmarks":[]}';

describe("syncJsonBackupToDrive", () => {
  it("未認証(token無し)ならunauthenticatedを返し、アップロードは呼ばない", async () => {
    const uploadBackup = vi.fn();
    const result = await syncJsonBackupToDrive(json, 1000, false, undefined, {
      getAuthToken: vi.fn().mockResolvedValue(null),
      uploadBackup,
    });
    expect(result).toEqual({ status: "unauthenticated" });
    expect(uploadBackup).not.toHaveBeenCalled();
  });

  it("既知ファイルIDが無ければ検索してから新規アップロードする", async () => {
    const findBackupFile = vi.fn().mockResolvedValue(null);
    const uploadBackup = vi.fn().mockResolvedValue("new-file-id");
    const resolveFolderPath = vi.fn().mockResolvedValue("folder-app");
    const result = await syncJsonBackupToDrive(json, 1000, false, undefined, {
      getAuthToken: vi.fn().mockResolvedValue("token-abc"),
      findBackupFile,
      uploadBackup,
      resolveFolderPath,
    });
    expect(result).toEqual({ status: "synced", fileId: "new-file-id", syncedAt: 1000 });
    expect(findBackupFile).toHaveBeenCalledWith("token-abc");
    expect(resolveFolderPath).toHaveBeenCalledWith(["app", "New Tab Board"], "token-abc");
    expect(uploadBackup).toHaveBeenCalledWith(json, "token-abc", null, "folder-app");
  });

  it("既知ファイルIDがあれば検索をスキップして更新アップロードする", async () => {
    const findBackupFile = vi.fn();
    const uploadBackup = vi.fn().mockResolvedValue("existing-file");
    const resolveFolderPath = vi.fn().mockResolvedValue("folder-app");
    const result = await syncJsonBackupToDrive(json, 2000, false, "existing-file", {
      getAuthToken: vi.fn().mockResolvedValue("token-abc"),
      findBackupFile,
      uploadBackup,
      resolveFolderPath,
    });
    expect(result).toEqual({ status: "synced", fileId: "existing-file", syncedAt: 2000 });
    expect(findBackupFile).not.toHaveBeenCalled();
    expect(uploadBackup).toHaveBeenCalledWith(json, "token-abc", "existing-file", "folder-app");
  });

  it("アップロード失敗はerrorステータスを返す", async () => {
    const result = await syncJsonBackupToDrive(json, 1000, false, undefined, {
      getAuthToken: vi.fn().mockResolvedValue("token-abc"),
      findBackupFile: vi.fn().mockResolvedValue(null),
      uploadBackup: vi.fn().mockRejectedValue(new Error("network down")),
      resolveFolderPath: vi.fn().mockResolvedValue("folder-app"),
    });
    expect(result).toEqual({ status: "error" });
  });

  it("フォルダ解決の失敗もerrorステータスを返す", async () => {
    const result = await syncJsonBackupToDrive(json, 1000, false, undefined, {
      getAuthToken: vi.fn().mockResolvedValue("token-abc"),
      resolveFolderPath: vi.fn().mockRejectedValue(new Error("network down")),
    });
    expect(result).toEqual({ status: "error" });
  });
});

describe("restoreJsonBackupFromDrive", () => {
  it("未認証(token無し)ならunauthenticatedを返す", async () => {
    const result = await restoreJsonBackupFromDrive(true, undefined, {
      getAuthToken: vi.fn().mockResolvedValue(null),
    });
    expect(result).toEqual({ status: "unauthenticated" });
  });

  it("バックアップファイルが無ければnot-foundを返す", async () => {
    const result = await restoreJsonBackupFromDrive(true, undefined, {
      getAuthToken: vi.fn().mockResolvedValue("token-abc"),
      findBackupFile: vi.fn().mockResolvedValue(null),
    });
    expect(result).toEqual({ status: "not-found" });
  });

  it("既知ファイルIDがあれば検索をスキップしてダウンロードする", async () => {
    const findBackupFile = vi.fn();
    const downloadBackup = vi.fn().mockResolvedValue(json);
    const result = await restoreJsonBackupFromDrive(true, "existing-file", {
      getAuthToken: vi.fn().mockResolvedValue("token-abc"),
      findBackupFile,
      downloadBackup,
    });
    expect(result).toEqual({ status: "restored", json });
    expect(findBackupFile).not.toHaveBeenCalled();
    expect(downloadBackup).toHaveBeenCalledWith("existing-file", "token-abc");
  });

  it("ダウンロード失敗はerrorステータスを返す", async () => {
    const result = await restoreJsonBackupFromDrive(true, "existing-file", {
      getAuthToken: vi.fn().mockResolvedValue("token-abc"),
      downloadBackup: vi.fn().mockRejectedValue(new Error("network down")),
    });
    expect(result).toEqual({ status: "error" });
  });
});
