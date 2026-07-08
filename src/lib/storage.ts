// storage.ts — chrome.storage(sync/local) ⇔ localStorage フォールバックの唯一の入出口(GUARDRAILS.md §8.2)
import type { AppLaunch, Bookmark, Note, Settings } from "../types";
import { logOp } from "./log";

const SYNC_KEY = "syncData";
const LOCAL_KEY = "localData";

export const DEFAULT_SETTINGS: Settings = {
  openIn: "same",
  theme: "auto",
  searchEngine: "https://www.google.com/search?q=%s",
};

type SyncShape = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };
type LocalShape = { notes: Note[] };

function hasChromeStorage(area: "sync" | "local"): boolean {
  return typeof chrome !== "undefined" && !!chrome.storage?.[area];
}

async function readArea<T>(area: "sync" | "local", key: string, fallback: T): Promise<T> {
  const started = Date.now();
  if (hasChromeStorage(area)) {
    const result = await chrome.storage[area].get(key);
    logOp("storage", "load", `chrome.storage.${area}`, { elapsedMs: Date.now() - started });
    return (result[key] as T | undefined) ?? fallback;
  }
  const raw = window.localStorage.getItem(`${area}:${key}`);
  logOp("storage", "load", `localStorage(fallback:${area})`, { elapsedMs: Date.now() - started });
  return raw ? (JSON.parse(raw) as T) : fallback;
}

async function writeArea<T>(area: "sync" | "local", key: string, value: T): Promise<void> {
  const started = Date.now();
  if (hasChromeStorage(area)) {
    await chrome.storage[area].set({ [key]: value });
    logOp("storage", "save", `chrome.storage.${area}`, { elapsedMs: Date.now() - started });
    return;
  }
  window.localStorage.setItem(`${area}:${key}`, JSON.stringify(value));
  logOp("storage", "save", `localStorage(fallback:${area})`, { elapsedMs: Date.now() - started });
}

export async function loadSyncData(): Promise<SyncShape> {
  return readArea<SyncShape>("sync", SYNC_KEY, {
    bookmarks: [],
    appLaunches: [],
    settings: DEFAULT_SETTINGS,
  });
}

export async function saveSyncData(data: SyncShape): Promise<void> {
  await writeArea("sync", SYNC_KEY, data);
}

export async function loadLocalData(): Promise<LocalShape> {
  return readArea<LocalShape>("local", LOCAL_KEY, { notes: [] });
}

export async function saveLocalData(data: LocalShape): Promise<void> {
  await writeArea("local", LOCAL_KEY, data);
}
