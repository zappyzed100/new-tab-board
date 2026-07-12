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
//
// NAS上のファイルは「そのままエディタで開いて読めるプレーンテキスト」で保存する
// (ユーザー指示)。IndexedDB側のsnapshot.contentはgzip+base64だが、NASへ書く直前に
// gzipDecompressして生テキストにする。読み戻し(getSnapshotBody)は呼び出し側が
// gzipDecompressする契約なので、NASの生テキストをgzipCompressし直して圧縮base64へ
// 正規化して返す(呼び出し側UIは無変更)。
// レイアウトは 年/月/日/ のフォルダ階層(例: 2026/7/12/<noteId>-<timestamp>-<id>.txt。
// 月・日はゼロ埋めしない——ユーザー指示)。ネイティブホストが親フォルダを自動生成する。
import { logOp } from "../runtime/log";
import { gzipCompress, gzipDecompress } from "../history/gzip";
import { getAllSnapshots, getNasFolderPath, markSnapshotArchived } from "../storage/db";
import { probeNasPath, readFileFromNas, writeFileToNas } from "./nasNativeHost";
import type { Snapshot } from "../../types";

/** NAS上の相対パス。スナップショットのtimestampのローカル日付でフォルダ分けする。 */
function archivePathFor(snapshot: Snapshot): string {
  const d = new Date(snapshot.timestamp);
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // ゼロ埋めしない(ユーザー指示: 「7」「12」フォルダ)
  const day = d.getDate();
  return `${y}/${m}/${day}/${snapshot.noteId}-${snapshot.timestamp}-${snapshot.id}.txt`;
}

type NasDeps = {
  getNasFolderPath?: () => Promise<string | undefined>;
  probeNasPath?: typeof probeNasPath;
  writeFileToNas?: typeof writeFileToNas;
  readFileFromNas?: typeof readFileFromNas;
};

/** 1件をNASへ「プレーンテキスト」で書き込み、再読込して内容が一致することを検証する
 * (サイズだけでなく全文比較)。IndexedDB側のcontentはgzip+base64なので書く直前に展開する。 */
export async function flushSnapshotToNas(
  path: string,
  snapshot: Snapshot,
  deps: NasDeps = {},
): Promise<boolean> {
  if (snapshot.content === undefined) return false; // 既に本体が無い(二重フラッシュ防御)
  const _writeFileToNas = deps.writeFileToNas ?? writeFileToNas;
  const _readFileFromNas = deps.readFileFromNas ?? readFileFromNas;
  const relPath = archivePathFor(snapshot);
  try {
    const plain = await gzipDecompress(snapshot.content);
    const ok = await _writeFileToNas(path, relPath, plain);
    if (!ok) return false;
    const written = await _readFileFromNas(path, relPath);
    return written === plain;
  } catch (err) {
    // contentが壊れたgzip等でdecompressに失敗しても、flushAll全体を巻き込まない。
    logOp("nasArchive", "flush-snapshot-error", relPath, { error: err });
    return false;
  }
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
      await markSnapshotArchived(snapshot.id, archivePathFor(snapshot));
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

/** archived済み/未archivedを問わず、スナップショットの本文を「gzip+base64の圧縮文字列」で返す
 * (呼び出し側SearchPanel/HistoryPanelがgzipDecompressする契約)。
 * NASオフライン等で読めなければnull(呼び出し側はdegrade表示する — SPEC.md §4.3)。 */
export async function getSnapshotBody(
  snapshot: Snapshot,
  deps: NasDeps = {},
): Promise<string | null> {
  if (snapshot.content !== undefined) return snapshot.content; // ローカルは既に圧縮base64
  if (snapshot.archived && snapshot.archivePath) {
    const raw = await readArchivedSnapshot(snapshot.archivePath, deps);
    if (raw === null) return null;
    // 新形式(.txt)はNAS上プレーンテキストなので圧縮base64へ正規化して返す。
    // 旧形式(.snapshot)は既に圧縮base64で書かれているためそのまま(後方互換)。
    return snapshot.archivePath.endsWith(".txt") ? await gzipCompress(raw) : raw;
  }
  return null;
}
