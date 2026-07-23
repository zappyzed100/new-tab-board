// nasImageStore.ts — ノート添付画像のNAS入出力(保存/一括読み込み)。ブラウザ側に永続化しない
//
// `chrome.storage.local`(10MBクォータ)にもIndexedDBにも画像を置かない——実体はNASだけで、
// タブ内には揮発のメモリキャッシュしか持たない(ユーザー指示・2026-07-23)。NASフォルダが
// 未登録なら保存も読み込みも行わない(=ノートに画像は表示されない)。
import { logOp } from "../runtime/log";
import { now as clockNow } from "../runtime/clock";
import { getNasFolderPath } from "../storage/db";
import { listNasImages, readBinaryFromNas, writeBinaryToNas } from "../externalIO/nasNativeHost";
import { imageExtensionFor, nasImageRelPath } from "./noteImages";

/** テスト時に実NAS・実IndexedDBを経由しないよう差し替える口(他のlibモジュールと同じ流儀)。 */
export type NasImageDeps = {
  getFolderPath?: () => Promise<string | null>;
  writeBinary?: (path: string, filename: string, contentBase64: string) => Promise<boolean>;
  readBinary?: (path: string, filename: string) => Promise<string | null>;
  listImages?: (path: string) => Promise<string[] | null>;
  newImageId?: () => string;
  /** 貼り付け日をファイル名へ入れるための現在時刻(テストでは固定値を注入する)。 */
  now?: () => number;
};

function resolve(deps: NasImageDeps) {
  return {
    getFolderPath: deps.getFolderPath ?? getNasFolderPath,
    writeBinary: deps.writeBinary ?? ((p, f, c) => writeBinaryToNas(p, f, c)),
    readBinary: deps.readBinary ?? ((p, f) => readBinaryFromNas(p, f)),
    listImages: deps.listImages ?? ((p) => listNasImages(p)),
    newImageId: deps.newImageId ?? (() => crypto.randomUUID()),
    now: deps.now ?? clockNow,
  };
}

/** Blob → base64(データURLのヘッダを落とした本体だけ)。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  // 引数の展開はスタック上限があるため小分けにする(数MBの画像で RangeError にしない)。
  const CHUNK = 0x8000;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 → Blob。 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

/** NAS相対パスの拡張子からMIMEを引く(不明はoctet-stream=表示されないが壊しもしない)。 */
export function mimeTypeForRelPath(relPath: string): string {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** 画像をNASへ保存し、本文から参照するNAS相対パスを返す。NAS未登録/書き込み失敗はnull。 */
export async function saveNoteImageToNas(
  noteId: string,
  blob: Blob,
  deps: NasImageDeps = {},
): Promise<string | null> {
  const d = resolve(deps);
  const base = await d.getFolderPath();
  if (!base) {
    logOp("note-image", "skip-no-nas-folder", `note=${noteId}`);
    return null;
  }
  const relPath = nasImageRelPath(
    noteId,
    d.now(),
    d.newImageId(),
    imageExtensionFor(blob.type),
  );
  const ok = await d.writeBinary(base, relPath, await blobToBase64(blob));
  logOp("note-image", ok ? "save" : "save-failed", `note=${noteId} path=${relPath}`);
  return ok ? relPath : null;
}

/** NASの images/ 配下を全部読み、相対パス→Blob のマップにして返す(起動時の一括読み込み)。
 * NAS未登録/未接続なら空のマップ——呼び出し側は「画像が無い」として扱えばよい。 */
export async function loadAllNoteImagesFromNas(
  deps: NasImageDeps = {},
): Promise<Map<string, Blob>> {
  const d = resolve(deps);
  const images = new Map<string, Blob>();
  const base = await d.getFolderPath();
  if (!base) {
    logOp("note-image", "skip-load-no-nas-folder", "");
    return images;
  }
  const files = await d.listImages(base);
  if (files === null) {
    logOp("note-image", "load-failed", "list-images"); // host未導入/NAS未接続。表示しないだけで害はない
    return images;
  }
  for (const relPath of files) {
    const base64 = await d.readBinary(base, relPath);
    if (base64 === null) continue; // 1枚読めなくても他を諦めない
    images.set(relPath, base64ToBlob(base64, mimeTypeForRelPath(relPath)));
  }
  logOp("note-image", "load", `found=${files.length} loaded=${images.size}`);
  return images;
}
