// jsonBackupSync.ts — 全データJSONバックアップのDrive同期オーケストレーション(SPEC.md §4.7)
// driveSync.ts(ノート現行内容の同期)と同じ設計: 未サインイン/未許可はunauthenticatedとして
// 静かに返す(自動バックアップ時にユーザーへ毎回プロンプトを出さないため)。
import { getAuthToken } from "./googleAuth";
import { downloadBackup, findBackupFile, uploadBackup } from "./jsonBackup";
import { resolveFolderPath } from "./drive";
import { logOp } from "../runtime/log";

/** バックアップファイルの置き場所(ユーザー指示: マイドライブ直下ではなくノート同期と
 * 同じapp/New Tab Board/配下へ統一する。2026-07-16)。 */
const BACKUP_FOLDER_PATH = ["app", "New Tab Board"];

export type JsonBackupSyncResult =
  | { status: "synced"; fileId: string; syncedAt: number }
  | { status: "unauthenticated" }
  | { status: "error" };

export type JsonBackupRestoreResult =
  | { status: "restored"; json: string }
  | { status: "not-found" }
  | { status: "unauthenticated" }
  | { status: "error" };

export type JsonBackupSyncDeps = {
  getAuthToken?: typeof getAuthToken;
  findBackupFile?: typeof findBackupFile;
  uploadBackup?: typeof uploadBackup;
  downloadBackup?: typeof downloadBackup;
  resolveFolderPath?: typeof resolveFolderPath;
};

/** 全データJSONをDriveへ同期する。既存ファイルIDが分かっていれば渡してDrive検索を省略できる。 */
export async function syncJsonBackupToDrive(
  json: string,
  now: number,
  interactive: boolean,
  knownFileId: string | undefined,
  deps: JsonBackupSyncDeps = {},
): Promise<JsonBackupSyncResult> {
  const _getAuthToken = deps.getAuthToken ?? getAuthToken;
  const _findBackupFile = deps.findBackupFile ?? findBackupFile;
  const _uploadBackup = deps.uploadBackup ?? uploadBackup;
  const _resolveFolderPath = deps.resolveFolderPath ?? resolveFolderPath;

  logOp(
    "jsonBackupSync",
    "sync-start",
    `interactive=${interactive} knownFileId=${knownFileId ?? "none"}`,
  );
  const token = await _getAuthToken(interactive);
  if (!token) {
    logOp("jsonBackupSync", "sync-unauthenticated", "");
    return { status: "unauthenticated" };
  }

  try {
    const folderId = await _resolveFolderPath(BACKUP_FOLDER_PATH, token);
    const existingId = knownFileId ?? (await _findBackupFile(token));
    logOp(
      "jsonBackupSync",
      "sync-resolved-existing-id",
      `existingId=${existingId ?? "none(will create)"} source=${knownFileId ? "known" : "search"} folderId=${folderId}`,
    );
    const fileId = await _uploadBackup(json, token, existingId ?? null, folderId);
    logOp("jsonBackupSync", "sync-done", `fileId=${fileId}`);
    return { status: "synced", fileId, syncedAt: now };
  } catch (err) {
    logOp("jsonBackupSync", "sync-error", "", { error: err });
    return { status: "error" };
  }
}

/** Drive上のバックアップファイルからJSON文字列を取得する(データ管理パネルの「Driveから復元」用)。
 * ユーザーの明示的なクリック操作から呼ぶ想定のためinteractive=trueで初回ログインを促せる。 */
export async function restoreJsonBackupFromDrive(
  interactive: boolean,
  knownFileId: string | undefined,
  deps: JsonBackupSyncDeps = {},
): Promise<JsonBackupRestoreResult> {
  const _getAuthToken = deps.getAuthToken ?? getAuthToken;
  const _findBackupFile = deps.findBackupFile ?? findBackupFile;
  const _downloadBackup = deps.downloadBackup ?? downloadBackup;

  const token = await _getAuthToken(interactive);
  if (!token) return { status: "unauthenticated" };

  try {
    const fileId = knownFileId ?? (await _findBackupFile(token));
    if (!fileId) return { status: "not-found" };
    const json = await _downloadBackup(fileId, token);
    return { status: "restored", json };
  } catch (err) {
    logOp("jsonBackupSync", "restore-error", "", { error: err });
    return { status: "error" };
  }
}
