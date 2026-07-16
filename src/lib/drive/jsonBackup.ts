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

/** バックアップJSONをDriveへアップロードする(新規=POST/既存=PATCH)。アップロード先ファイルIDを返す。
 * folderIdを渡すと、新規作成時はそこへ作り、既存ファイルの上書き時もそこへ入れ直す(移動)。
 * 元々マイドライブ直下に固定名で置く設計だったが、ユーザー指示によりapp/New Tab Board/配下へ
 * 統一した(2026-07-16)。既に作成済みの古いファイル(ルート直下)も、次の上書きで自動的に
 * 正しいフォルダへ移る(uploadNoteのreparentQueryと同じ発想)。 */
export async function uploadBackup(
  json: string,
  token: string,
  existingFileId: string | null,
  folderId: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const boundary = "newtabboard-backup";
  const metadata: Record<string, unknown> = {
    appProperties: { [BACKUP_APP_PROPERTY.key]: BACKUP_APP_PROPERTY.value },
    // 保存済みIDの指す先がゴミ箱にいる場合、PATCHは成功するのにファイルはゴミ箱に
    // 残り続ける(=検索にもマイドライブにも出ない。ユーザーがDriveの中身を手で削除した後、
    // 「退避しました」なのにどこにも見えない実害が出た・2026-07-16)。上書きのたびに
    // trashed:falseを送り、ゴミ箱にいたら自動で復活させる(新規作成時は元々falseでno-op)。
    trashed: false,
  };
  if (!existingFileId) {
    metadata.name = BACKUP_FILE_NAME;
    metadata.mimeType = "application/json";
    if (folderId) metadata.parents = [folderId];
  }
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n` +
    `--${boundary}--`;

  const reparentQuery =
    existingFileId && folderId ? `&addParents=${folderId}&removeParents=root` : "";
  const url = existingFileId
    ? `${UPLOAD_URL}/${existingFileId}?uploadType=multipart${reparentQuery}`
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
    // 保存済みファイルIDの指す先が消えている(404)場合は、その古いIDを使い続けて毎回404に
    // なるのを防ぐため、新規作成へフォールバックする(呼び出し側は返り値の新IDを保存する)。
    if (existingFileId && res.status === 404) {
      logOp("jsonBackup", "upload-recreate", "existing file gone (404); creating new");
      return uploadBackup(json, token, null, folderId, fetchImpl);
    }
    // Googleのエラー本文(error.errors[].reason等)を残す——403はスコープ不足・レート制限・
    // クォータ超過等、原因がstatusだけでは分からない一時的な診断用(2026-07-16)。
    const bodyText = await res.text().catch(() => "");
    logOp("jsonBackup", "upload-error", `status=${res.status} body=${bodyText.slice(0, 500)}`);
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
