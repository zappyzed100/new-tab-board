// driveGeneration.ts — Drive版の世代カウンタ(native-host/nas_bridge.pyのread/bump-generationと対)。
// app/New Tab Board/data/generation.txt に整数1つで持つ(NASのdata/generation.txtと同じ発想)。
// ユーザー指示: NAS/Driveどちらかへの接続が失敗しても、接続できた方の世代だけを進めることで
// 抜けの無い情報受け渡しの土台にする(現状は単一端末運用のため、これを読んでpush/pullを決める
// 経路はまだ無い——将来マルチデバイス対応する時にNASのdecideActiveSyncと同じ判定を追加できる
// よう、世代を記録するところまでを先に用意する布石)。
import { resolveFolderPath, type FetchLike } from "./drive";
import { logOp } from "../runtime/log";

const GENERATION_FOLDER_PATH = ["app", "New Tab Board", "data"];
const GENERATION_FILENAME = "generation.txt";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

async function findGenerationFile(
  folderId: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<string | null> {
  const q = `'${folderId}' in parents and name='${GENERATION_FILENAME}' and trashed=false`;
  const res = await fetchImpl(`${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive世代ファイル検索失敗: HTTP ${res.status}`);
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

/** ファイル未作成・壊れは0とみなす(native-host/nas_bridge.pyの_read_generationと同じ規則)。 */
function parseGeneration(text: string): number {
  const n = parseInt(text.trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

async function readGenerationFileContent(
  fileId: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<number> {
  const res = await fetchImpl(`${FILES_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return 0;
  return parseGeneration(await res.text());
}

async function writeGenerationFileContent(
  fileId: string | null,
  folderId: string,
  value: number,
  token: string,
  fetchImpl: FetchLike,
): Promise<void> {
  if (fileId) {
    const res = await fetchImpl(`${UPLOAD_URL}/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body: String(value),
    });
    if (!res.ok) throw new Error(`Drive世代ファイル更新失敗: HTTP ${res.status}`);
    return;
  }
  const boundary = "newtabboard-generation";
  const metadata = { name: GENERATION_FILENAME, mimeType: "text/plain", parents: [folderId] };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n\r\n${value}\r\n` +
    `--${boundary}--`;
  const res = await fetchImpl(`${UPLOAD_URL}?uploadType=multipart`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive世代ファイル作成失敗: HTTP ${res.status}`);
}

/** Driveの現在の世代番号を読む(未作成/読み取り失敗はnull=呼び出し側は「未接続」として扱う)。 */
export async function readDriveGeneration(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<number | null> {
  try {
    logOp("driveGeneration", "read-start", `path=${GENERATION_FOLDER_PATH.join("/")}`);
    const folderId = await resolveFolderPath(GENERATION_FOLDER_PATH, token, fetchImpl);
    const fileId = await findGenerationFile(folderId, token, fetchImpl);
    if (!fileId) {
      logOp("driveGeneration", "read-no-file", `folderId=${folderId}`);
      return 0; // 未作成=世代0(NAS側の「ファイル未作成は0」と同じ規則)
    }
    const value = await readGenerationFileContent(fileId, token, fetchImpl);
    logOp("driveGeneration", "read-done", `folderId=${folderId} fileId=${fileId} value=${value}`);
    return value;
  } catch (err) {
    logOp("driveGeneration", "read-error", "", { error: err });
    return null;
  }
}

/** Driveの世代番号を+1して新値を返す(読取→+1→書込。失敗はnull)。 */
export async function bumpDriveGeneration(
  token: string,
  fetchImpl: FetchLike = fetch,
): Promise<number | null> {
  try {
    logOp("driveGeneration", "bump-start", `path=${GENERATION_FOLDER_PATH.join("/")}`);
    const folderId = await resolveFolderPath(GENERATION_FOLDER_PATH, token, fetchImpl);
    const fileId = await findGenerationFile(folderId, token, fetchImpl);
    const current = fileId ? await readGenerationFileContent(fileId, token, fetchImpl) : 0;
    const next = current + 1;
    await writeGenerationFileContent(fileId, folderId, next, token, fetchImpl);
    logOp(
      "driveGeneration",
      "bump-done",
      `folderId=${folderId} fileId=${fileId ?? "new"} ${current}->${next}`,
    );
    return next;
  } catch (err) {
    logOp("driveGeneration", "bump-error", "", { error: err });
    return null;
  }
}
