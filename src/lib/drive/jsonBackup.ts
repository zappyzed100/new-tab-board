// jsonBackup.ts — 全データJSONバックアップのGoogle Drive API v3クライアント(SPEC.md §4.7)
// ノート現行内容の同期(drive.ts)と同じ最小権限drive.fileの範囲内で、固定の1ファイル
// (appPropertiesで検索)を都度上書きする。履歴は含まない(exportImport.tsのExportPayload参照)。
import { logOp } from "../runtime/log";

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const BACKUP_APP_PROPERTY = { key: "newTabBoardBackup", value: "true" };
const BACKUP_FILE_NAME = "new-tab-board-backup.json";

export type FetchLike = typeof fetch;

/** appPropertiesでバックアップ用ファイルを検索する。無ければnull。 */
export async function findBackupFile(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const q = `appProperties has { key='${BACKUP_APP_PROPERTY.key}' and value='${BACKUP_APP_PROPERTY.value}' } and trashed=false`;
  const res = await fetchImpl(`${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    logOp("jsonBackup", "find-error", `status=${res.status}`);
    throw new Error(`Drive検索失敗: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

/** バックアップJSONをDriveへアップロードする(新規=POST/既存=PATCH)。アップロード先ファイルIDを返す。 */
export async function uploadBackup(
  json: string,
  token: string,
  existingFileId: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const boundary = "newtabboard-backup";
  const metadata: Record<string, unknown> = {
    appProperties: { [BACKUP_APP_PROPERTY.key]: BACKUP_APP_PROPERTY.value },
  };
  if (!existingFileId) {
    metadata.name = BACKUP_FILE_NAME;
    metadata.mimeType = "application/json";
  }
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n` +
    `--${boundary}--`;

  const url = existingFileId
    ? `${UPLOAD_URL}/${existingFileId}?uploadType=multipart`
    : `${UPLOAD_URL}?uploadType=multipart`;
  const res = await fetchImpl(url, {
    method: existingFileId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    logOp("jsonBackup", "upload-error", `status=${res.status}`);
    throw new Error(`Driveアップロード失敗: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { id: string };
  logOp("jsonBackup", "upload", `fileId=${data.id} mode=${existingFileId ? "update" : "create"}`);
  return data.id;
}

/** バックアップファイルの中身(JSON文字列)をDriveから取得する。 */
export async function downloadBackup(
  fileId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const res = await fetchImpl(`${FILES_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    logOp("jsonBackup", "download-error", `status=${res.status}`);
    throw new Error(`Driveダウンロード失敗: HTTP ${res.status}`);
  }
  return res.text();
}
