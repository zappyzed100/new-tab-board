// db.ts — IndexedDBの唯一の入出口(履歴スナップショット・全文検索インデックス・NAS設定。GUARDRAILS.md §8.2)
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { IndexEntry, Snapshot } from "../types";
import { logOp } from "./log";

const NAS_HANDLE_KEY = "nasDirectoryHandle";

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
    // FileSystemDirectoryHandleは構造化複製可能でIndexedDBへ直接保存できる(ブラウザ仕様)。
    value: unknown;
  };
}

const DB_NAME = "new-tab-board";
const DB_VERSION = 2;

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

export async function getNasDirectoryHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await getDb();
  return db.get("settings", NAS_HANDLE_KEY) as Promise<FileSystemDirectoryHandle | undefined>;
}

export async function setNasDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await getDb();
  await db.put("settings", handle, NAS_HANDLE_KEY);
  logOp("db", "put", "settings/nasDirectoryHandle");
}
