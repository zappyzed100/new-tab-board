// drive.ts — Google Drive API v3クライアント(最小権限drive.fileでノート現行内容のみミラー。SPEC.md §4.2)
// 履歴は上げない・現行内容のみ上書き(競合はlast-write-winsで単純化——SPEC.md §8)。
import { logOp } from "./log";

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";

export type FetchLike = typeof fetch;

/** appPropertiesにnoteIdを持たせて検索し、対応するDriveファイルIDを探す。無ければnull。 */
export async function findFileForNote(
  noteId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  const q = `appProperties has { key='noteId' and value='${noteId}' } and trashed=false`;
  const res = await fetchImpl(`${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive検索失敗: HTTP ${res.status}`);
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

/** ノート現行内容をDriveへアップロード(新規=POST/既存=PATCH)する。アップロード先ファイルIDを返す。 */
export async function uploadNote(
  note: { id: string; title: string; content: string },
  token: string,
  existingFileId: string | null,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const boundary = `newtabboard-${note.id}`;
  const metadata: Record<string, unknown> = { appProperties: { noteId: note.id } };
  if (!existingFileId) {
    metadata.name = `${note.title}.md`;
    metadata.mimeType = "text/markdown";
  }
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/markdown; charset=UTF-8\r\n\r\n${note.content}\r\n` +
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
  if (!res.ok) throw new Error(`Driveアップロード失敗: HTTP ${res.status}`);
  const data = (await res.json()) as { id: string };
  logOp(
    "drive",
    "upload",
    `note=${note.id} fileId=${data.id} mode=${existingFileId ? "update" : "create"}`,
  );
  return data.id;
}
