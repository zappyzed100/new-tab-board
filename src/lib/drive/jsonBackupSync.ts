// jsonBackupSync.ts — 全データJSONバックアップのDrive同期オーケストレーション(SPEC.md §4.7)
// driveSync.ts(ノート現行内容の同期)と同じ設計: 未サインイン/未許可はunauthenticatedとして
// 静かに返す(自動バックアップ時にユーザーへ毎回プロンプトを出さないため)。
import { getAuthToken } from "./googleAuth";
import { downloadBackup, findBackupFile, uploadBackup } from "./jsonBackup";
import { logOp } from "../runtime/log";

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
    // 注意: バックアップファイルはappPropertiesで検索するだけで、フォルダには一切置かない
    // (Drive直下=マイドライブに単一ファイルとして置く設計)。ここではフォルダ解決を一切行わない
    // ——「Driveへ退避」でappフォルダが増えるように見える場合、原因はこの関数ではない
    // (ユーザー報告の切り分け用ログ・一時的)。
    const existingId = knownFileId ?? (await _findBackupFile(token));
    logOp(
      "jsonBackupSync",
      "sync-resolved-existing-id",
      `existingId=${existingId ?? "none(will create)"} source=${knownFileId ? "known" : "search"}`,
    );
    const fileId = await _uploadBackup(json, token, existingId ?? null);
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
