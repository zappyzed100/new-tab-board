// nasArchive.ts — SSD一次退避(IndexedDB)→NAS本archiveのstore-and-forward(SPEC.md §4.3)
//
// 安全条件: NAS書き込みを検証してからしかSSD側を消さない(データが0箇所になる瞬間を作らない)。
// 冪等(archived済みスナップショットはスキップ)。
//
// 以前はshowDirectoryPicker()で得たFileSystemDirectoryHandleを使っていたが、Chrome
// 拡張機能のページから呼ぶと選択後もAbortErrorになる既知のChromiumバグ
// (WICG/file-system-access#314、crbug.com/issues/40240444)が実機で解消できず
// (エラーメッセージすら出ない無反応のままだった)、ユーザー指示によりNative
// Messaging(native-host/nas_bridge.py)経由の書き込みへ置き換えた。NASフォルダは
// パス文字列(例: "Z:\\NAS\\backup")で指定する——契約はdocs/nas-native-messaging-protocol.md。
import { logOp } from "../runtime/log";
import { getAllSnapshots, getNasFolderPath, markSnapshotArchived } from "../storage/db";
import { probeNasPath, readFileFromNas, writeFileToNas } from "./nasNativeHost";
import type { Snapshot } from "../../types";

function archiveFileName(snapshot: Snapshot): string {
  return `${snapshot.noteId}-${snapshot.timestamp}-${snapshot.id}.snapshot`;
}

type NasDeps = {
  getNasFolderPath?: () => Promise<string | undefined>;
  probeNasPath?: typeof probeNasPath;
  writeFileToNas?: typeof writeFileToNas;
  readFileFromNas?: typeof readFileFromNas;
};

/** 1件をNASへ書き込み、再読込して内容が一致することを検証する(サイズだけでなく全文比較)。 */
export async function flushSnapshotToNas(
  path: string,
  snapshot: Snapshot,
  deps: NasDeps = {},
): Promise<boolean> {
  if (snapshot.content === undefined) return false; // 既に本体が無い(二重フラッシュ防御)
  const _writeFileToNas = deps.writeFileToNas ?? writeFileToNas;
  const _readFileFromNas = deps.readFileFromNas ?? readFileFromNas;
  const fileName = archiveFileName(snapshot);
  const ok = await _writeFileToNas(path, fileName, snapshot.content);
  if (!ok) return false;
  const written = await _readFileFromNas(path, fileName);
  return written === snapshot.content;
}

/** NASフォルダのパスが設定・到達可能なら、未アーカイブの全スナップショットをフラッシュする。 */
export async function flushAllToNas(
  deps: NasDeps = {},
): Promise<{ flushed: number; failed: number }> {
  const _getNasFolderPath = deps.getNasFolderPath ?? getNasFolderPath;
  const _probeNasPath = deps.probeNasPath ?? probeNasPath;
  const path = await _getNasFolderPath();
  if (!path) return { flushed: 0, failed: 0 };

  if (!(await _probeNasPath(path))) {
    logOp("nasArchive", "probe-failed", path);
    return { flushed: 0, failed: 0 };
  }

  const pending = (await getAllSnapshots()).filter((s) => !s.archived && s.content !== undefined);
  let flushed = 0;
  let failed = 0;
  for (const snapshot of pending) {
    const ok = await flushSnapshotToNas(path, snapshot, deps);
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

/** archived済みスナップショットの本文をNASから読み戻す(オフライン時はnull)。 */
export async function readArchivedSnapshot(
  archivePath: string,
  deps: NasDeps = {},
): Promise<string | null> {
  const _getNasFolderPath = deps.getNasFolderPath ?? getNasFolderPath;
  const _readFileFromNas = deps.readFileFromNas ?? readFileFromNas;
  const path = await _getNasFolderPath();
  if (!path) return null;
  const content = await _readFileFromNas(path, archivePath);
  if (content === null) {
    logOp("nasArchive", "read-error", archivePath);
  }
  return content;
}

/** archived済み/未archivedを問わず、スナップショットの本文(gzip圧縮済み文字列)を取得する。
 * NASオフライン等で読めなければnull(呼び出し側はdegrade表示する — SPEC.md §4.3)。 */
export async function getSnapshotBody(
  snapshot: Snapshot,
  deps: NasDeps = {},
): Promise<string | null> {
  if (snapshot.content !== undefined) return snapshot.content;
  if (snapshot.archived && snapshot.archivePath) {
    return readArchivedSnapshot(snapshot.archivePath, deps);
  }
  return null;
}
