// drive.ts — Google Drive API v3クライアント(最小権限drive.fileでノート現行内容のみミラー。SPEC.md §4.2)
// 履歴は上げない・現行内容のみ上書き(競合はlast-write-winsで単純化——SPEC.md §8)。
import { logOp } from "../runtime/log";
import {
  clearDriveFolderIds,
  deleteDriveFolderId,
  getDriveFolderIds,
  saveDriveFolderId,
} from "../storage/db";

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export type FetchLike = typeof fetch;

/** フォルダ解決の結果をセッション内でキャッシュする(パス文字列→folderId)。IndexedDB
 * (db.tsのgetDriveFolderIds/saveDriveFolderId)にも同じ内容を永続化しており、こちらは
 * 「同じタブが動いている間だけ」有効な高速パス(IndexedDB読み取りすら省く)。永続キャッシュの
 * 詳細はresolveSegment参照。 */
const folderIdCache = new Map<string, string>();
/** 解決中(検索→未発見なら作成)の段ごとのin-flight Promise(パス文字列→Promise)。
 * 複数ノートのペインがそれぞれ独立にsyncNoteToDriveを呼ぶため、Cmd/Ctrl+Sで全ペインが
 * ほぼ同時にresolveFolderPathへ入ると、folderIdCacheがまだ空の間に「同じ名前のフォルダを
 * 検索→無い→作成」を複数の呼び出しが並行に実行し、Driveは同名フォルダの重複作成を防がない
 * ため"app"や"New Tab Board"フォルダが複製されるバグがあった(ユーザー報告)。同じパスへの
 * 同時呼び出しをこのPromiseキャッシュで束ね、getOrCreateFolderの実呼び出しを1回に絞る。
 * この対策はセッション内(同じタブ)の同時呼び出しにしか効かない——**別々のタブ/リロード後の
 * 再訪問で再び検索→未発見→作成が起きる残存リスクは、IndexedDBの永続キャッシュ
 * (resolveSegment)で解消する**(ユーザー設計: 保存済みIDがあれば名前検索すらしない)。 */
const folderResolvePromiseCache = new Map<string, Promise<string>>();

/** フォルダIDキャッシュ(セッション内メモリ+永続の両方)をクリアする。テスト用の他、
 * 「共有フォルダを選択」(DataPanel.tsx)でも使う——永続キャッシュ(IndexedDB)だけ
 * クリアしてメモリの`folderIdCache`を残すと、同じタブ内では選び直した後もresolveSegment
 * がメモリキャッシュを優先して古いフォルダIDを使い続けてしまう(実機不具合の是正・
 * 2026-07-16)。 */
export async function resetDriveFolderCache(): Promise<void> {
  folderIdCache.clear();
  folderResolvePromiseCache.clear();
  await clearDriveFolderIds();
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
  logOp("drive", "getOrCreateFolder-search", `name=${name} parentId=${parentId ?? "root"} q=${q}`);
  const findRes = await fetchImpl(`${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!findRes.ok) {
    logOp(
      "drive",
      "getOrCreateFolder-search-error",
      `name=${name} parentId=${parentId ?? "root"} status=${findRes.status}`,
    );
    throw new Error(`Driveフォルダ検索失敗: HTTP ${findRes.status}`);
  }
  const foundFiles = ((await findRes.json()) as { files?: { id: string }[] }).files ?? [];
  logOp(
    "drive",
    "getOrCreateFolder-search-result",
    `name=${name} parentId=${parentId ?? "root"} matches=${foundFiles.length} ids=${foundFiles.map((f) => f.id).join(",")}`,
  );
  const found = foundFiles[0]?.id;
  if (found) {
    logOp(
      "drive",
      "getOrCreateFolder-hit",
      `name=${name} parentId=${parentId ?? "root"} id=${found}`,
    );
    return found;
  }

  logOp("drive", "getOrCreateFolder-create-start", `name=${name} parentId=${parentId ?? "root"}`);
  const createRes = await fetchImpl(`${FILES_URL}?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: parentId ? [parentId] : ["root"],
    }),
  });
  if (!createRes.ok) {
    logOp(
      "drive",
      "getOrCreateFolder-create-error",
      `name=${name} parentId=${parentId ?? "root"} status=${createRes.status}`,
    );
    throw new Error(`Driveフォルダ作成失敗: HTTP ${createRes.status}`);
  }
  const createdId = ((await createRes.json()) as { id: string }).id;
  logOp(
    "drive",
    "getOrCreateFolder-created",
    `name=${name} parentId=${parentId ?? "root"} id=${createdId}`,
  );
  return createdId;
}

/** 永続キャッシュのフォルダIDがまだDrive上に実在するか(trashedでないか)を確認する。
 * ユーザーがDriveの中身を手で削除した後、キャッシュだけが死んだIDを返し続け、そのIDを
 * addParents等で使う操作が軒並みHTTP 404になる不具合の是正(2026-07-16実機確認)。 */
async function folderStillExists(
  id: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${FILES_URL}/${id}?fields=id,trashed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false; // 404等=もう存在しない
    const data = (await res.json()) as { trashed?: boolean };
    return data.trashed !== true;
  } catch {
    return false;
  }
}

/** 1段分を解決する(ユーザー設計の優先順位): ①保存済みのフォルダIDがあればそれを使う
 * (名前検索すらしない)②無ければ名前+親で検索③見つかれば保存④無ければ新規作成して保存
 * ——以後は名前でなくIDでアクセスする。同じpath(累積パス)への同時呼び出しはPromiseを共有し、
 * 実際のDrive通信を1回に絞る(上のfolderResolvePromiseCacheコメント参照)。保存済みIDは
 * 使う前に実在確認する(folderStillExists参照——手動削除でキャッシュだけが死んだIDを
 * 指し続ける不具合の是正)。 */
async function resolveSegment(
  path: string,
  part: string,
  parentId: string | null,
  token: string,
  fetchImpl: FetchLike,
): Promise<string> {
  const cached = folderIdCache.get(path);
  if (cached) {
    logOp("drive", "resolveSegment-mem-cache-hit", `path=${path} id=${cached}`);
    return cached;
  }
  const inFlight = folderResolvePromiseCache.get(path);
  if (inFlight) {
    logOp("drive", "resolveSegment-join-inflight", `path=${path}`);
    return inFlight;
  }
  logOp(
    "drive",
    "resolveSegment-start",
    `path=${path} part=${part} parentId=${parentId ?? "root"}`,
  );
  const promise = (async () => {
    const persisted = (await getDriveFolderIds())[path];
    if (persisted) {
      if (await folderStillExists(persisted, token, fetchImpl)) {
        logOp("drive", "resolveSegment-persisted-hit", `path=${path} id=${persisted}`);
        return persisted;
      }
      logOp(
        "drive",
        "resolveSegment-persisted-stale",
        `path=${path} id=${persisted} — folder missing/trashed on Drive, re-resolving`,
      );
      await deleteDriveFolderId(path);
    } else {
      logOp("drive", "resolveSegment-persisted-miss", `path=${path} — falling back to name search`);
    }
    const id = await getOrCreateFolder(part, parentId, token, fetchImpl);
    await saveDriveFolderId(path, id);
    logOp("drive", "resolveSegment-persisted-save", `path=${path} id=${id}`);
    return id;
  })()
    .then((id) => {
      folderIdCache.set(path, id);
      logOp("drive", "resolveSegment-done", `path=${path} id=${id}`);
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
  logOp("drive", "resolveFolderPath-call", `parts=${cacheKey}`);
  const cached = folderIdCache.get(cacheKey);
  if (cached) {
    logOp("drive", "resolveFolderPath-mem-cache-hit", `parts=${cacheKey} id=${cached}`);
    return cached;
  }
  let parentId: string | null = null;
  let path = "";
  for (const part of parts) {
    path = path ? `${path}/${part}` : part;
    parentId = await resolveSegment(path, part, parentId, token, fetchImpl);
  }
  logOp("drive", "resolveFolderPath-resolved", `parts=${cacheKey} id=${parentId}`);
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

/** ファイル本文をそのまま取得する(世代pull用。active/の.txtの中身は noteToMarkdown が出した
 * front matter + Markdown なので、呼び出し側は markdownToNote で Note へ戻せる)。 */
export async function downloadFileContent(
  fileId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const res = await fetchImpl(`${FILES_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    logOp("drive", "download-error", `fileId=${fileId} status=${res.status}`);
    throw new Error(`Driveダウンロード失敗: HTTP ${res.status}`);
  }
  logOp("drive", "download", `fileId=${fileId}`);
  return await res.text();
}

/** フォルダ配下の、noteId(appProperties)を持つファイルを列挙する({fileId, noteId}の配列)。
 * Drive APIの`appProperties has {...}`句は`value='...'`の完全一致しか受け付けず`!=`は
 * 使えない(2026-07-16実機確認: `value!=''`を送るとHTTP 400 Bad Requestになるバグだった)。
 * 「noteIdが空でない」という絞り込みはサーバ側の句からは落とし、フォルダ内の全ファイルを
 * 取得してからクライアント側のfilterで行う(元々あった)。 */
export async function listNoteFilesInFolder(
  folderId: string,
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ id: string; noteId: string }[]> {
  const q = `'${folderId}' in parents and trashed=false`;
  logOp("drive", "listNoteFilesInFolder-query", `folderId=${folderId} q=${q}`);
  const res = await fetchImpl(
    `${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,appProperties)`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    logOp("drive", "listNoteFilesInFolder-error", `folderId=${folderId} status=${res.status}`);
    throw new Error(`Driveフォルダ一覧失敗: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    files?: { id: string; appProperties?: { noteId?: string } }[];
  };
  const result = (data.files ?? [])
    .filter((f) => f.appProperties?.noteId)
    .map((f) => ({ id: f.id, noteId: f.appProperties!.noteId as string }));
  logOp(
    "drive",
    "listNoteFilesInFolder-result",
    `folderId=${folderId} total=${data.files?.length ?? 0} withNoteId=${result.length}`,
  );
  return result;
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
 * あるため(ユーザー指示)。id固定の名前(日付フォルダ・special)は値が変わらないので実質no-op。
 * opts.mimeType(既定"text/markdown")は呼び出し側が明示指定する——active/(拡張子.txt)は
 * "text/plain"を渡す(iPhoneのGoogle Driveアプリが"text/markdown"を「サポートされていない
 * ファイル形式」として開けなかった実機不具合の修正・2026-07-16。日付フォルダ/specialは
 * .md のまま既定のtext/markdownを使う)。**新規作成だけでなく既存ファイルの更新(PATCH)でも
 * 毎回送る**——filenameと同じ理由で、以前text/markdownとして作られた既存ファイルも
 * 次回同期で正しいmimeTypeへ是正されるようにするため。 */
export async function uploadNote(
  note: { id: string; title: string; content: string },
  token: string,
  existingFileId: string | null,
  fetchImpl: FetchLike = fetch,
  opts: { folderId?: string; kind?: string; filename?: string; mimeType?: string } = {},
): Promise<string> {
  const boundary = `newtabboard-${note.id}`;
  const mimeType = opts.mimeType ?? "text/markdown";
  const metadata: Record<string, unknown> = {
    appProperties: { noteId: note.id, ...(opts.kind ? { ntbKind: opts.kind } : {}) },
    name: opts.filename ?? `${note.title}.md`,
    mimeType,
  };
  if (existingFileId) {
    // 保存済みdriveFileIdの指す先がゴミ箱にいてもPATCHは成功してしまい、ファイルは
    // ゴミ箱に残り続ける(jsonBackup.tsのuploadBackupと同じ罠)。上書きのたびに
    // trashed:falseを送って自動で復活させる。新規作成(files.create)ではtrashedは
    // 書き込み不可フィールドでHTTP 403 fieldNotWritableになるため、既存ファイルの
    // 更新(PATCH)時だけ送る(実機確認・2026-07-16)。
    metadata.trashed = false;
  } else {
    if (opts.folderId) metadata.parents = [opts.folderId];
  }
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}; charset=UTF-8\r\n\r\n${note.content}\r\n` +
    `--${boundary}--`;

  // 既存ファイルへの上書き時、opts.folderIdが指定されていれば毎回addParents/removeParentsを
  // 送り、正しいフォルダへ入れ直す(実機確認: ノートのactiveファイルがマイドライブ直下に
  // 迷い込んだまま、既知のdriveFileIdでPATCHし続けても場所が直らなかった不具合の自己修復。
  // 2026-07-16)。既にfolderIdの配下にあれば実質no-op、root以外の場所にあってもfolderIdは
  // 追加されるため最低限そちらでも見えるようになる。
  const reparentQuery =
    existingFileId && opts.folderId ? `&addParents=${opts.folderId}&removeParents=root` : "";
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
    // 保存済みのdriveFileIdが指す先が消えている(404)場合は、古いIDで上書きし続けて毎回
    // 404になるのを防ぐため、新規作成へフォールバックする(呼び出し側は返り値の新IDを保存)。
    if (existingFileId && res.status === 404) {
      logOp("drive", "upload-recreate", `note=${note.id} existing file gone (404); creating new`);
      return uploadNote(note, token, null, fetchImpl, opts);
    }
    const bodyText = await res.text().catch(() => "");
    logOp(
      "drive",
      "upload-error",
      `note=${note.id} status=${res.status} body=${bodyText.slice(0, 500)}`,
    );
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
