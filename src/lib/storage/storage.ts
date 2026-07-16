// storage.ts — chrome.storage(sync/local) ⇔ localStorage フォールバックの唯一の入出口(GUARDRAILS.md §8.2)
import type { AppLaunch, Bookmark, LocalData, Settings } from "../../types";
import { logOp } from "../runtime/log";

const SYNC_KEY = "syncData";
const LOCAL_KEY = "localData";

/** 初回起動時のタグ候補の既定値(ユーザー指示: distから取ってきた時点で既に入っているように)。
 * GitHub全リポジトリ(zappyzed100)のREADMEだけを読んで、繰り返し登場する技術/ドメインから
 * 選定(2026-07-17)。ユーザーが手で並べ替え・削除できる(tagCandidates.ts)——ここは初期値のみ。 */
const DEFAULT_TAG_CANDIDATES = [
  "Python",
  "TypeScript",
  "Rust",
  "Flutter",
  "Chrome拡張",
  "LLM",
  "ガードレール",
  "Playwright",
  "データエンジニアリング",
  "最適化",
  "UI/UX",
  "睡眠記録",
  "Google Apps Script",
  "Google Drive連携",
  "自動化",
  "ポートフォリオ",
  "ドットファイル",
  "メディアプレイヤー",
];

export const DEFAULT_SETTINGS: Settings = {
  openIn: "same",
  theme: "auto",
  searchEngine: "https://www.google.com/search?q=%s",
  tagCandidates: DEFAULT_TAG_CANDIDATES,
};

type SyncShape = { bookmarks: Bookmark[]; appLaunches: AppLaunch[]; settings: Settings };
type LocalShape = LocalData;

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
