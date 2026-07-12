// db.ts — IndexedDBの唯一の入出口(履歴スナップショット・全文検索インデックス・NAS設定。GUARDRAILS.md §8.2)
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { IndexEntry, Snapshot } from "../../types";
import { logOp } from "../runtime/log";

const NAS_FOLDER_PATH_KEY = "nasFolderPath";
// Gemini APIキーは秘匿情報。この設定ストア(IndexedDB)はchrome.storage.syncにも
// Driveの全データJSONバックアップ(buildExportPayloadはsync+notesのみ)にも乗らないため、
// キーが同期・バックアップ経由で外部へ漏れない(§7 秘匿)。
const GEMINI_API_KEY_KEY = "geminiApiKey";

interface AppDB extends DBSchema {
  snapshots: {
    key: string;
    value: Snapshot;
    indexes: { "by-note": string };
  };
  searchIndex: {
    key: string;
    value: IndexEntry;
  };
  settings: {
    key: string;
    value: unknown;
  };
  pastedImages: {
    key: string;
    value: PastedImageRecord;
  };
}

/** Ctrl+Vで貼り付けた画像の一次保存レコード(ユーザー指示。NASへは出さずローカルのみ)。 */
export type PastedImageRecord = { id: string; blob: Blob; type: string; createdAt: number };

const DB_NAME = "new-tab-board";
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

function getDb(): Promise<IDBPDatabase<AppDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const snapshots = db.createObjectStore("snapshots", { keyPath: "id" });
          snapshots.createIndex("by-note", "noteId");
          db.createObjectStore("searchIndex", { keyPath: "token" });
        }
        if (oldVersion < 2) {
          db.createObjectStore("settings");
        }
        if (oldVersion < 3) {
          db.createObjectStore("pastedImages", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function putSnapshot(snapshot: Snapshot): Promise<void> {
  const started = Date.now();
  const db = await getDb();
  await db.put("snapshots", snapshot);
  logOp("db", "put", `snapshots/${snapshot.id}`, { elapsedMs: Date.now() - started });
}

export async function getSnapshotsByNote(noteId: string): Promise<Snapshot[]> {
  const db = await getDb();
  return db.getAllFromIndex("snapshots", "by-note", noteId);
}

export async function getAllSnapshots(): Promise<Snapshot[]> {
  const db = await getDb();
  return db.getAll("snapshots");
}

export async function getSnapshot(id: string): Promise<Snapshot | undefined> {
  const db = await getDb();
  return db.get("snapshots", id);
}

export async function deleteSnapshot(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("snapshots", id);
}

/** NAS排出後の状態(本体削除・archived確定・archivePath記録)へ更新する(SPEC.md §4.3)。 */
export async function markSnapshotArchived(id: string, archivePath: string): Promise<void> {
  const db = await getDb();
  const existing = await db.get("snapshots", id);
  if (!existing) return;
  await db.put("snapshots", { ...existing, content: undefined, archived: true, archivePath });
  logOp("db", "archive", `snapshots/${id} -> ${archivePath}`);
}

export async function putIndexEntry(entry: IndexEntry): Promise<void> {
  const db = await getDb();
  await db.put("searchIndex", entry);
}

export async function getIndexEntry(token: string): Promise<IndexEntry | undefined> {
  const db = await getDb();
  return db.get("searchIndex", token);
}

export async function getAllIndexEntries(): Promise<IndexEntry[]> {
  const db = await getDb();
  return db.getAll("searchIndex");
}

/** NASフォルダのパス文字列(例: "Z:\\NAS\\backup")を返す。未設定ならundefined。
 * native-host/nas_bridge.py(NASブリッジ)へそのまま渡す絶対パス。 */
export async function getNasFolderPath(): Promise<string | undefined> {
  const db = await getDb();
  return db.get("settings", NAS_FOLDER_PATH_KEY) as Promise<string | undefined>;
}

export async function setNasFolderPath(path: string): Promise<void> {
  const db = await getDb();
  await db.put("settings", path, NAS_FOLDER_PATH_KEY);
  logOp("db", "put", "settings/nasFolderPath");
}

/** Gemini APIキーを返す。未設定ならundefined。 */
export async function getGeminiApiKey(): Promise<string | undefined> {
  const db = await getDb();
  return db.get("settings", GEMINI_API_KEY_KEY) as Promise<string | undefined>;
}

export async function setGeminiApiKey(key: string): Promise<void> {
  const db = await getDb();
  await db.put("settings", key, GEMINI_API_KEY_KEY);
  // NO-LOG: APIキーそのものはログに出さない(§7 秘匿)。設定された事実だけ記録する。
  logOp("db", "put", "settings/geminiApiKey");
}

// Gemini APIの1日あたり使用回数(ユーザー指示: 450回でGPT-OSS 120Bへの乗り換え警告を出す)。
const GEMINI_USAGE_KEY = "geminiUsage";
type GeminiUsageRecord = { date: string; count: number };

/** epoch ms からローカル日付キー(YYYY-MM-DD)を作る(1日単位の使用量集計・日跨ぎ判定用)。 */
export function geminiUsageDateKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 今日(today=日付キー)のGemini使用回数を返す。記録が別日なら0(日跨ぎで数え直し)。 */
export async function getGeminiUsageCount(today: string): Promise<number> {
  const db = await getDb();
  const rec = (await db.get("settings", GEMINI_USAGE_KEY)) as GeminiUsageRecord | undefined;
  return rec && rec.date === today ? rec.count : 0;
}

/** Gemini APIを1回使ったことを記録し、今日の累計回数を返す(日付が変われば1から数え直す)。
 * 同時呼び出しで数え落とさないよう readwrite トランザクション内で read→+1→write する。 */
export async function recordGeminiUsage(today: string): Promise<number> {
  const db = await getDb();
  const tx = db.transaction("settings", "readwrite");
  const rec = (await tx.store.get(GEMINI_USAGE_KEY)) as GeminiUsageRecord | undefined;
  const count = (rec && rec.date === today ? rec.count : 0) + 1;
  await tx.store.put({ date: today, count }, GEMINI_USAGE_KEY);
  await tx.done;
  return count;
}

/** 貼り付け画像を1件保存する(ローカルのみ。NASには出さない——ユーザー指示)。 */
export async function putPastedImage(rec: PastedImageRecord): Promise<void> {
  const db = await getDb();
  await db.put("pastedImages", rec);
  logOp("db", "put", `pastedImages/${rec.id} (${rec.type})`);
}

/** 貼り付け画像を全件、新しい順で返す。 */
export async function getAllPastedImages(): Promise<PastedImageRecord[]> {
  const db = await getDb();
  const all = await db.getAll("pastedImages");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/** 貼り付け画像を1件削除する。 */
export async function deletePastedImage(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("pastedImages", id);
  logOp("db", "delete", `pastedImages/${id}`);
}
