// driveSync.ts — ノート現行内容のDrive同期オーケストレーション(SPEC.md §4.2・§8)
// 履歴は上げない・現行内容のみ上書き。競合はlast-write-winsで単純化(SPEC.md §8)。
import { getAuthToken } from "./googleAuth";
import { findFileForNote, resolveFolderPath, uploadNote } from "./drive";
import { noteToMarkdown } from "../externalIO/nasArchive";
import { logOp } from "../runtime/log";
import type { Note } from "../../types";

/** Drive上の「現在編集中のノート」を置くフォルダ(ユーザー指示: app/New Tab Board/active/)。 */
export const ACTIVE_FOLDER_PATH = ["app", "New Tab Board", "active"];
/** active フォルダのファイルを区別する appProperties の種別(日付フォルダのファイルと分けるため)。 */
export const ACTIVE_KIND = "active";

/** Driveのファイル名として見苦しくない一行にする(改行除去・パス区切りに見える文字を置換)。 */
function sanitizeDriveFilenamePart(title: string): string {
  const oneLine = title.replace(/[\r\n]+/g, " ").trim();
  const noSlash = oneLine.replace(/[/\\]/g, "-");
  return noSlash === "" ? "(無題)" : noSlash;
}

/** activeフォルダのファイル名(ユーザー指示: <タイトル>.txtにする。ただし同じタイトルの
 * ノートが複数あってもDrive上で衝突・見分けがつかなくならないよう、末尾にnoteIdの短い
 * 断片を付ける。拡張子はNASのactiveNasFilenameForと同じ理由で.txt——スマホのDriveアプリ/
 * テキストビューアでの閲覧性を優先。中身はnoteToMarkdownのまま無変更・2026-07-16)。 */
export function activeFilenameFor(note: { id: string; title: string }): string {
  return `${sanitizeDriveFilenamePart(note.title)} (${note.id.slice(0, 8)}).txt`;
}

export type SyncResult =
  | { status: "synced"; driveFileId: string; lastSyncedAt: number }
  | { status: "skipped-empty" }
  | { status: "unauthenticated" }
  | { status: "error" };

export type SyncDeps = {
  getAuthToken?: typeof getAuthToken;
  findFileForNote?: typeof findFileForNote;
  uploadNote?: typeof uploadNote;
  resolveFolderPath?: typeof resolveFolderPath;
};

/** noteIdごとの直列化チェーン。**同じノートの同期が並行して走らないようにする**(2026-07-20の実害)。
 * 「既存ファイルを探す→無ければ作る」はcheck-then-actなので、複数ペイン/複数タブ/前景復帰の
 * 同期が同時に走ると両方が「無い」と判断してPOSTし、**同一noteIdのファイルがDrive上に2つ**できる。
 * こうなるとfindFileForNoteはfiles[0]しか返さないため片方が永久に取り残され、さらにそこからpullすると
 * 同じidのNoteが2件生まれてupdateNote(id一致の全件を更新)経由で本文が混ざる。
 * (active/todos.txtが同時刻に2つ作られたのと同じ型のレース。) */
const syncChainByNoteId = new Map<string, Promise<unknown>>();

/** アップロード済みファイルIDのメモリキャッシュ。Drive検索(files.list)は作成直後の
 * ファイルを即座に返さないことがある(結果整合)ため、直列化だけでは連続アップロード時に
 * 「探す→見つからない→作る」を再び踏みうる。同一コンテキスト内はこのマップで確実に
 * 既存IDを引き当てる(note.driveFileIdがReact stateへ書き戻る前の窓を埋める)。 */
const knownActiveFileIdByNoteId = new Map<string, string>();

/** ノート1件をDriveの active フォルダへ同期する。空ノートはアップロードしない(ユーザー指示)。
 * 未サインイン/未許可はunauthenticatedとして静かに返す(日常同期でプロンプトを出さないため)。
 * 同じノートに対する呼び出しは直列化する(syncChainByNoteIdのコメント参照)。 */
export async function syncNoteToDrive(
  note: Note,
  now: number,
  interactive: boolean,
  deps: SyncDeps = {},
): Promise<SyncResult> {
  // 空ファイルはDriveへ上げない(ユーザー指示)。既存ファイルの削除は board 側の突合で行う。
  // 直列化の前に判定する——空ノートはチェーンへ乗せる必要がない。
  if (note.content.trim() === "") return { status: "skipped-empty" };

  const prev = syncChainByNoteId.get(note.id) ?? Promise.resolve();
  // 前段が失敗しても後段は走らせる(失敗を握って次へ繋ぐ)。
  const run = prev.then(
    () => syncNoteToDriveUnserialized(note, now, interactive, deps),
    () => syncNoteToDriveUnserialized(note, now, interactive, deps),
  );
  syncChainByNoteId.set(
    note.id,
    run.catch(() => undefined),
  );
  return run;
}

/** テスト用: 直列化チェーンとファイルIDキャッシュを捨てる(モジュール状態のテスト間漏れ防止)。 */
export function resetDriveSyncState(): void {
  syncChainByNoteId.clear();
  knownActiveFileIdByNoteId.clear();
}

async function syncNoteToDriveUnserialized(
  note: Note,
  now: number,
  interactive: boolean,
  deps: SyncDeps,
): Promise<SyncResult> {
  const _getAuthToken = deps.getAuthToken ?? getAuthToken;
  const _findFileForNote = deps.findFileForNote ?? findFileForNote;
  const _uploadNote = deps.uploadNote ?? uploadNote;
  const _resolveFolderPath = deps.resolveFolderPath ?? resolveFolderPath;

  const token = await _getAuthToken(interactive);
  if (!token) return { status: "unauthenticated" };

  try {
    logOp(
      "driveSync",
      "resolve-folder-start",
      `note=${note.id} path=${ACTIVE_FOLDER_PATH.join("/")}`,
    );
    const folderId = await _resolveFolderPath(ACTIVE_FOLDER_PATH, token);
    logOp("driveSync", "resolve-folder-done", `note=${note.id} folderId=${folderId}`);
    // 既知ID → メモリキャッシュ → Drive検索 の順。メモリキャッシュはDrive検索の結果整合
    // (作成直後のファイルが検索に出ない窓)を埋めるためのもの——ここが無いと、連続アップロードで
    // 同一noteIdのファイルを二度作りうる(knownActiveFileIdByNoteIdのコメント参照)。
    const existingId =
      note.driveFileId ??
      knownActiveFileIdByNoteId.get(note.id) ??
      (await _findFileForNote(note.id, token, undefined, ACTIVE_KIND));
    // ファイル内容(front matter付きmd)はNASのactive/<タイトル> (id8桁).txtと同一構造だが、
    // Driveのファイル名だけは<タイトル> (短いid).txt にする(ユーザー指示: Drive上で見て
    // 分かる名前にしたい)。中身のidは今までどおり保つのでfindFileForNote等の検索・突合には
    // 影響しない。mimeTypeもtext/plainにする——text/markdownのままだとiPhoneのDriveアプリで
    // 「サポートされていないファイル形式です」となり開けなかった実機不具合の修正(2026-07-16)。
    const fileId = await _uploadNote(
      { id: note.id, title: note.title, content: noteToMarkdown(note) },
      token,
      existingId,
      undefined,
      { folderId, kind: ACTIVE_KIND, filename: activeFilenameFor(note), mimeType: "text/plain" },
    );
    knownActiveFileIdByNoteId.set(note.id, fileId); // 次の同期が検索を待たず既存を引けるように
    return { status: "synced", driveFileId: fileId, lastSyncedAt: now };
  } catch (err) {
    logOp("driveSync", "sync-error", `note=${note.id}`, { error: err });
    return { status: "error" };
  }
}
