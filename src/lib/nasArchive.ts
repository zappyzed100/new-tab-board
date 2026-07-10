// nasArchive.ts — SSD一次退避(IndexedDB)→NAS本archiveのstore-and-forward(SPEC.md §4.3)
//
// 安全条件: NAS書き込みを検証してからしかSSD側を消さない(データが0箇所になる瞬間を作らない)。
// 冪等(archived済みスナップショットはスキップ)。フォルダ権限はタブ全閉で失効しうるため、
// 新規タブページが開いたタイミングで権限確認→有効なうちにフラッシュする想定(service workerでは
// File System Accessが使えないため新規タブ文脈でのみ実行される)。
import { logOp } from "./log";
import { getAllSnapshots, getNasDirectoryHandle, markSnapshotArchived } from "./db";
import type { Snapshot } from "../types";

const PROBE_FILE_NAME = ".new-tab-board-probe";

function archiveFileName(snapshot: Snapshot): string {
  return `${snapshot.noteId}-${snapshot.timestamp}-${snapshot.id}.snapshot`;
}

/** NASフォルダへの到達性を簡易チェックする(小ファイルの読み書き試行)。 */
export async function probeNasReachable(dir: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const handle = await dir.getFileHandle(PROBE_FILE_NAME, { create: true });
    const writable = await handle.createWritable();
    await writable.write("ok");
    await writable.close();
    const file = await handle.getFile();
    return (await file.text()) === "ok";
  } catch (err) {
    logOp("nasArchive", "probe-failed", String(err));
    return false;
  }
}

/** 1件をNASへ書き込み、再読込して内容が一致することを検証する(サイズだけでなく全文比較)。 */
export async function flushSnapshotToNas(
  dir: FileSystemDirectoryHandle,
  snapshot: Snapshot,
): Promise<boolean> {
  if (snapshot.content === undefined) return false; // 既に本体が無い(二重フラッシュ防御)
  const fileName = archiveFileName(snapshot);
  try {
    const handle = await dir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(snapshot.content);
    await writable.close();
    const file = await handle.getFile();
    const written = await file.text();
    return written === snapshot.content;
  } catch (err) {
    logOp("nasArchive", "flush-error", `snapshot=${snapshot.id}`, { error: err });
    return false;
  }
}

/** NASフォルダの権限が有効なら、未アーカイブの全スナップショットをフラッシュする。
 * getNasDirectoryHandleはテストでフェイクに差し替え可能(実FileSystemDirectoryHandleは
 * 関数プロパティを持つホストオブジェクトでfake-indexeddbの構造化複製検査を通らないため)。 */
export async function flushAllToNas(
  deps: { getNasDirectoryHandle?: () => Promise<FileSystemDirectoryHandle | undefined> } = {},
): Promise<{ flushed: number; failed: number }> {
  const _getNasDirectoryHandle = deps.getNasDirectoryHandle ?? getNasDirectoryHandle;
  const dir = await _getNasDirectoryHandle();
  if (!dir) return { flushed: 0, failed: 0 };

  const permission = await dir.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    logOp("nasArchive", "permission-not-granted", permission);
    return { flushed: 0, failed: 0 };
  }

  if (!(await probeNasReachable(dir))) {
    return { flushed: 0, failed: 0 };
  }

  const pending = (await getAllSnapshots()).filter((s) => !s.archived && s.content !== undefined);
  let flushed = 0;
  let failed = 0;
  for (const snapshot of pending) {
    const ok = await flushSnapshotToNas(dir, snapshot);
    if (ok) {
      await markSnapshotArchived(snapshot.id, archiveFileName(snapshot));
      flushed++;
    } else {
      failed++;
    }
  }
  logOp("nasArchive", "flush-all", `flushed=${flushed} failed=${failed}`);
  return { flushed, failed };
}

type NasHandleDeps = {
  getNasDirectoryHandle?: () => Promise<FileSystemDirectoryHandle | undefined>;
};

/** archived済みスナップショットの本文をNASから読み戻す(オフライン時はnull)。 */
export async function readArchivedSnapshot(
  archivePath: string,
  deps: NasHandleDeps = {},
): Promise<string | null> {
  const _getNasDirectoryHandle = deps.getNasDirectoryHandle ?? getNasDirectoryHandle;
  const dir = await _getNasDirectoryHandle();
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(archivePath);
    const file = await handle.getFile();
    return await file.text();
  } catch (err) {
    logOp("nasArchive", "read-error", archivePath, { error: err });
    return null;
  }
}

/** archived済み/未archivedを問わず、スナップショットの本文(gzip圧縮済み文字列)を取得する。
 * NASオフライン等で読めなければnull(呼び出し側はdegrade表示する — SPEC.md §4.3)。 */
export async function getSnapshotBody(
  snapshot: Snapshot,
  deps: NasHandleDeps = {},
): Promise<string | null> {
  if (snapshot.content !== undefined) return snapshot.content;
  if (snapshot.archived && snapshot.archivePath) {
    return readArchivedSnapshot(snapshot.archivePath, deps);
  }
  return null;
}
