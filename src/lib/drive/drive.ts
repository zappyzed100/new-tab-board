// drive.ts — Google Drive API v3クライアント(最小権限drive.fileでノート現行内容のみミラー。SPEC.md §4.2)
// 履歴は上げない・現行内容のみ上書き(競合はlast-write-winsで単純化——SPEC.md §8)。
import { logOp } from "../runtime/log";

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export type FetchLike = typeof fetch;

/** フォルダ解決の結果をセッション内でキャッシュする(パス文字列→folderId)。同じ
 * app/New Tab Board/active/ 等を毎回検索しないため。 */
const folderIdCache = new Map<string, string>();
/** 解決中(検索→未発見なら作成)の段ごとのin-flight Promise(パス文字列→Promise)。
 * 複数ノートのペインがそれぞれ独立にsyncNoteToDriveを呼ぶため、Cmd/Ctrl+Sで全ペインが
 * ほぼ同時にresolveFolderPathへ入ると、folderIdCacheがまだ空の間に「同じ名前のフォルダを
 * 検索→無い→作成」を複数の呼び出しが並行に実行し、Driveは同名フォルダの重複作成を防がない
 * ため"app"や"New Tab Board"フォルダが複製されるバグがあった(ユーザー報告)。同じパスへの
 * 同時呼び出しをこのPromiseキャッシュで束ね、getOrCreateFolderの実呼び出しを1回に絞る。 */
const folderResolvePromiseCache = new Map<string, Promise<string>>();

/** テスト用: フォルダIDキャッシュをクリアする。 */
export function resetDriveFolderCacheForTests(): void {
  folderIdCache.clear();
  folderResolvePromiseCache.clear();
}

/** 親フォルダ(parentId=null はマイドライブ直下)配下に name のフォルダを get-or-create する。 */
export async function getOrCreateFolder(
  name: string,
  parentId: string | null,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const parentClause = parentId ? `'${parentId}' in parents` : "'root' in parents";
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER_MIME}' and ${parentClause} and trashed=false`;
  const findRes = await fetchImpl(`${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!findRes.ok) throw new Error(`Driveフォルダ検索失敗: HTTP ${findRes.status}`);
  const found = ((await findRes.json()) as { files?: { id: string }[] }).files?.[0]?.id;
  if (found) return found;

  const createRes = await fetchImpl(`${FILES_URL}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : ["root"],
    }),
  });
  if (!createRes.ok) throw new Error(`Driveフォルダ作成失敗: HTTP ${createRes.status}`);
  return ((await createRes.json()) as { id: string }).id;
}

/** 1段分をget-or-createする。同じpath(累積パス)への同時呼び出しはPromiseを共有し、
 * getOrCreateFolderの実呼び出しを1回に絞る(上のfolderResolvePromiseCacheコメント参照)。 */
async function resolveSegment(
  path: string,
  part: string,
  parentId: string | null,
  token: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const cached = folderIdCache.get(path);
  if (cached) return cached;
  const inFlight = folderResolvePromiseCache.get(path);
  if (inFlight) return inFlight;
  const promise = getOrCreateFolder(part, parentId, token, fetchImpl)
    .then((id) => {
      folderIdCache.set(path, id);
      return id;
    })
    .finally(() => folderResolvePromiseCache.delete(path));
  folderResolvePromiseCache.set(path, promise);
  return promise;
}

/** パス(例: ["app","New Tab Board","active"])を順に get-or-create し、末端フォルダIDを返す。
 * 解決結果はキャッシュする(パスの各段を毎回検索しない)。 */
export async function resolveFolderPath(
  parts: string[],
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const cacheKey = parts.join("/");
  const cached = folderIdCache.get(cacheKey);
  if (cached) return cached;
  let parentId: string | null = null;
  let path = "";
  for (const part of parts) {
    path = path ? `${path}/${part}` : part;
    parentId = await resolveSegment(path, part, parentId, token, fetchImpl);
  }
  return parentId as string;
}

/** Driveファイルを削除する(ノートがブラウザ上で消された/空になった時に対応ファイルを消す)。 */
export async function deleteDriveFile(
  fileId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const res = await fetchImpl(`${FILES_URL}/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  // 既に無い(404)は成功扱い(消したい結果は達成されている)。
  if (!res.ok && res.status !== 404) {
    logOp("drive", "delete-error", `fileId=${fileId} status=${res.status}`);
    throw new Error(`Drive削除失敗: HTTP ${res.status}`);
  }
  logOp("drive", "delete", `fileId=${fileId}`);
}

/** フォルダ配下の、noteId(appProperties)を持つファイルを列挙する({fileId, noteId}の配列)。 */
export async function listNoteFilesInFolder(
  folderId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ id: string; noteId: string }[]> {
  const q = `'${folderId}' in parents and appProperties has { key='noteId' and value!='' } and trashed=false`;
  const res = await fetchImpl(
    `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,appProperties)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Driveフォルダ一覧失敗: HTTP ${res.status}`);
  const data = (await res.json()) as {
    files?: { id: string; appProperties?: { noteId?: string } }[];
  };
  return (data.files ?? [])
    .filter((f) => f.appProperties?.noteId)
    .map((f) => ({ id: f.id, noteId: f.appProperties!.noteId as string }));
}

/** appPropertiesにnoteIdを持たせて検索し、対応するDriveファイルIDを探す。無ければnull。
 * kindを渡すと ntbKind でも絞り込む(同じnoteIdの「active」ファイルと「日付」ファイルを区別)。 */
export async function findFileForNote(
  noteId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
  kind?: string,
): Promise<string | null> {
  const kindClause = kind ? ` and appProperties has { key='ntbKind' and value='${kind}' }` : "";
  const q = `appProperties has { key='noteId' and value='${noteId}' }${kindClause} and trashed=false`;
  const res = await fetchImpl(`${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    logOp("drive", "find-error", `note=${noteId} status=${res.status}`);
    throw new Error(`Drive検索失敗: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

/** ノート現行内容をDriveへアップロード(新規=POST/既存=PATCH)する。アップロード先ファイルIDを返す。
 * opts.folderId を渡すと新規作成時にそのフォルダ配下へ置く。opts.kind は appProperties へ
 * 付与し、同じ noteId でも「active」用と「日付」用のファイルを区別できるようにする。
 * ファイル名(opts.filename)は新規/既存どちらでも毎回送る——タイトルベースの名前
 * (driveSyncのactive/)はノートのリネームのたびにDrive上のファイル名も追従させる必要が
 * あるため(ユーザー指示)。id固定の名前(日付フォルダ・special)は値が変わらないので実質no-op。 */
export async function uploadNote(
  note: { id: string; title: string; content: string },
  token: string,
  existingFileId: string | null,
  fetchImpl: FetchLike = fetch,
  opts: { folderId?: string; kind?: string; filename?: string } = {},
): Promise<string> {
  const boundary = `newtabboard-${note.id}`;
  const metadata: Record<string, unknown> = {
    appProperties: { noteId: note.id, ...(opts.kind ? { ntbKind: opts.kind } : {}) },
    name: opts.filename ?? `${note.title}.md`,
  };
  if (!existingFileId) {
    metadata.mimeType = "text/markdown";
    if (opts.folderId) metadata.parents = [opts.folderId];
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
  if (!res.ok) {
    // 保存済みのdriveFileIdが指す先が消えている(404)場合は、古いIDで上書きし続けて毎回
    // 404になるのを防ぐため、新規作成へフォールバックする(呼び出し側は返り値の新IDを保存)。
    if (existingFileId && res.status === 404) {
      logOp("drive", "upload-recreate", `note=${note.id} existing file gone (404); creating new`);
      return uploadNote(note, token, null, fetchImpl, opts);
    }
    logOp("drive", "upload-error", `note=${note.id} status=${res.status}`);
    throw new Error(`Driveアップロード失敗: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { id: string };
  logOp(
    "drive",
    "upload",
    `note=${note.id} fileId=${data.id} mode=${existingFileId ? "update" : "create"}`,
  );
  return data.id;
}
