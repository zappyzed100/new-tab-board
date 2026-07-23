// db.ts — IndexedDBの唯一の入出口(履歴スナップショット・全文検索インデックス・NAS設定。GUARDRAILS.md §8.2)
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { IndexEntry, Snapshot } from "../../types";
import { logOp } from "../runtime/log";

const NAS_FOLDER_PATH_KEY = "nasFolderPath";
// Gemini APIキーは秘匿情報。この設定ストア(IndexedDB)はchrome.storage.syncにも
// Driveの全データJSONバックアップ(buildExportPayloadはsync+notesのみ)にも乗らないため、
// キーが同期・バックアップ経由で外部へ漏れない(§7 秘匿)。
const GEMINI_API_KEY_KEY = "geminiApiKey";
// スマホのバッテリー低下警告(GAS Web App中継)の接続設定。トークンは秘匿情報のため
// GEMINI_API_KEY_KEYと同じ理由でchrome.storage.sync/Driveバックアップには乗らない。
const BATTERY_WEBHOOK_CONFIG_KEY = "batteryWebhookConfig";
// この端末でアラーム音を鳴らすか(ユーザー指示: 複数PCで同じアラームが同時に鳴るのを避けたい)。
// **端末ローカル設定**なので settings backup/復元で他PCへ伝播しない db.ts に置く(Settings=syncData
// に置くと settingsBackup 経由で他PCへ復元され得るため不可)。未設定(undefined)は既定=鳴らす。
const ALARM_ENABLED_KEY = "alarmEnabled";
// Google Driveのフォルダパス(例: "app/New Tab Board/active")→フォルダIDの永続キャッシュ
// (ユーザー設計: 保存済みIDがあれば名前検索すらせずそれを使い、以後は名前でなくIDで
// アクセスする。セッションを跨いだ再訪問のたびに名前+親で検索し直すと、複数ペインが
// ほぼ同時に検索→未発見→作成を行った場合に同名フォルダが複製されるリスクが残るため)。
const DRIVE_FOLDER_IDS_KEY = "driveFolderIds";

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
}

const DB_NAME = "new-tab-board";
// v4: pastedImages ストアを削除した(2026-07-23)。画像は「ノートに添付してNASにだけ置く」方式へ
// 一本化し、ブラウザ側は揮発キャッシュしか持たない——ブラウザ内に画像実体を貯めない設計。
const DB_VERSION = 4;

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
        // v3の pastedImages は v4 で廃止したので新規には作らない。既存DBに残っていれば消す
        // ——旧ストアに溜まった画像ごと捨てる(NASへ移す価値のある一時データではない)。
        // 型からストアが消えているため、削除だけは名前で扱う。
        const legacy = db as unknown as {
          objectStoreNames: DOMStringList;
          deleteObjectStore: (name: string) => void;
        };
        if (legacy.objectStoreNames.contains("pastedImages")) {
          legacy.deleteObjectStore("pastedImages");
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

/** スマホのバッテリー低下警告のGAS Web App接続設定(url+共有トークン)。未設定ならundefined。 */
export type BatteryWebhookConfig = { url: string; token: string };

export async function getBatteryWebhookConfig(): Promise<BatteryWebhookConfig | undefined> {
  const db = await getDb();
  return db.get("settings", BATTERY_WEBHOOK_CONFIG_KEY) as Promise<
    BatteryWebhookConfig | undefined
  >;
}

export async function setBatteryWebhookConfig(config: BatteryWebhookConfig): Promise<void> {
  const db = await getDb();
  await db.put("settings", config, BATTERY_WEBHOOK_CONFIG_KEY);
  // NO-LOG: 共有トークンそのものはログに出さない(§7 秘匿。geminiApiKeyと同じ扱い)。
  logOp("db", "put", "settings/batteryWebhookConfig");
}

/** この端末でアラーム音を鳴らすか。未設定は既定=true(鳴らす。現状挙動を維持)。
 * background.ts が fireAlarm / pollBatteryStatus の入口で参照する。 */
export async function getAlarmEnabled(): Promise<boolean> {
  const db = await getDb();
  const v = (await db.get("settings", ALARM_ENABLED_KEY)) as boolean | undefined;
  return v ?? true;
}

export async function setAlarmEnabled(enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.put("settings", enabled, ALARM_ENABLED_KEY);
  logOp("db", "put", `settings/alarmEnabled=${enabled}`);
}

/** Google Driveのフォルダパス→フォルダIDの永続キャッシュ全体を返す(未設定なら空オブジェクト)。 */
export async function getDriveFolderIds(): Promise<Record<string, string>> {
  const db = await getDb();
  return (
    db.get("settings", DRIVE_FOLDER_IDS_KEY) as Promise<Record<string, string> | undefined>
  ).then((v) => v ?? {});
}

/** 1パス分のフォルダIDを永続キャッシュへ追記する(他パスのエントリを消さないよう
 * readwriteトランザクション内でread→マージ→writeする——複数パスがほぼ同時に解決される
 * ことがあるため、単純なread-then-writeだと後勝ちで他パスの記録が消えうる)。 */
export async function saveDriveFolderId(path: string, id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("settings", "readwrite");
  const current =
    ((await tx.store.get(DRIVE_FOLDER_IDS_KEY)) as Record<string, string> | undefined) ?? {};
  await tx.store.put({ ...current, [path]: id }, DRIVE_FOLDER_IDS_KEY);
  await tx.done;
  logOp("db", "put", `settings/driveFolderIds/${path}`);
}

/** テスト用: フォルダIDの永続キャッシュを空にする。 */
export async function clearDriveFolderIds(): Promise<void> {
  const db = await getDb();
  await db.delete("settings", DRIVE_FOLDER_IDS_KEY);
}

/** 1パス分のフォルダIDだけを永続キャッシュから消す(他パスは残す)。ユーザーがDrive上で
 * フォルダを手動削除した後もキャッシュが死んだIDを返し続け、addParents等の操作が404に
 * なり続けた不具合の是正(drive.tsのresolveSegmentが再検証で不在を検知した時に呼ぶ)。 */
export async function deleteDriveFolderId(path: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("settings", "readwrite");
  const current =
    ((await tx.store.get(DRIVE_FOLDER_IDS_KEY)) as Record<string, string> | undefined) ?? {};
  delete current[path];
  await tx.store.put(current, DRIVE_FOLDER_IDS_KEY);
  await tx.done;
  logOp("db", "delete", `settings/driveFolderIds/${path}`);
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
