// db.ts — IndexedDBの唯一の入出口(履歴スナップショット・全文検索インデックス。GUARDRAILS.md §8.2)
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { IndexEntry, Snapshot } from "../types";
import { logOp } from "./log";

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
}

const DB_NAME = "new-tab-board";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AppDB>> | null = null;

function getDb(): Promise<IDBPDatabase<AppDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const snapshots = db.createObjectStore("snapshots", { keyPath: "id" });
        snapshots.createIndex("by-note", "noteId");
        db.createObjectStore("searchIndex", { keyPath: "token" });
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

export async function getSnapshot(id: string): Promise<Snapshot | undefined> {
  const db = await getDb();
  return db.get("snapshots", id);
}

export async function deleteSnapshot(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("snapshots", id);
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
