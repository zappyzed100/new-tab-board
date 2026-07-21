// storage.ts — chrome.storage(local) ⇔ localStorage フォールバックの唯一の入出口(GUARDRAILS.md §8.2)
import type { AppLaunch, Bookmark, LocalData, Settings } from "../../types";
import { logOp } from "../runtime/log";

const SYNC_KEY = "syncData";
const LOCAL_KEY = "localData";
const STORAGE_WRITER_ID = crypto.randomUUID();

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
  try {
    if (hasChromeStorage(area)) {
      await chrome.storage[area].set({ [key]: value });
      logOp("storage", "save", `chrome.storage.${area}`, { elapsedMs: Date.now() - started });
      return;
    }
    window.localStorage.setItem(`${area}:${key}`, JSON.stringify(value));
    logOp("storage", "save", `localStorage(fallback:${area})`, { elapsedMs: Date.now() - started });
  } catch (err) {
    // 保存呼び出しは全て呼び出し側でvoid(fire-and-forget)されるため、ここでログしなければ
    // 失敗が完全に無音になる(2026-07-18: chrome.storage.syncの8KB/item上限超過で書き込みが
    // 静かに失敗しブックマークが消えた実インシデントを受けて追加)。
    logOp("storage", "save-error", `chrome.storage.${area}/${key}`, {
      error: err,
      elapsedMs: Date.now() - started,
    });
    throw err;
  }
}

/** bookmarks/appLaunches/settingsは元々chrome.storage.syncに乗せていたが、8KB/item上限を
 * 超えると書き込みが無音で失敗しブックマークが消える実害が出たため、上限の無いlocalへ
 * 移設した(2026-07-18)。複数端末間の自動同期はsyncの役目を諦め、Drive/NAS JSONバックアップの
 * 手動復元へ委ねる(SPEC.md §8)。既にsyncへ入っている旧データは初回読み込み時に一度だけ
 * localへ引き継ぐ(移行後はsync側を消し、以後syncは一切使わない)。 */
export async function loadSyncData(): Promise<SyncShape> {
  const fallback: SyncShape = { bookmarks: [], appLaunches: [], settings: DEFAULT_SETTINGS };
  const local = await readArea<SyncShape | null>("local", SYNC_KEY, null);
  if (local) return local;

  const legacy = await readArea<SyncShape | null>("sync", SYNC_KEY, null);
  if (!legacy) return fallback;

  logOp("storage", "migrate", "sync->local (legacy syncData found)");
  await writeArea("local", SYNC_KEY, legacy);
  if (hasChromeStorage("sync")) {
    try {
      await chrome.storage.sync.remove(SYNC_KEY);
    } catch (err) {
      logOp("storage", "migrate-cleanup-error", "chrome.storage.sync.remove failed (非致命的)", {
        error: err,
      });
    }
  }
  return legacy;
}

export async function saveSyncData(data: SyncShape): Promise<void> {
  await writeArea("local", SYNC_KEY, data);
}

export async function loadLocalData(): Promise<LocalShape> {
  return readArea<LocalShape>("local", LOCAL_KEY, { notes: [] });
}

export async function saveLocalData(data: LocalShape): Promise<void> {
  await writeArea("local", LOCAL_KEY, { ...data, storageWriterId: STORAGE_WRITER_ID });
}

/** 同一PCの別タブがlocalDataを保存した通知を購読する。UI層がchrome.storageへ直接触れないためのseam。 */
export function subscribeLocalData(listener: (data: LocalShape) => void): () => void {
  if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      const next = changes[LOCAL_KEY]?.newValue as LocalShape | undefined;
      if (!next) return;
      // chrome.storage.onChangedは書き込んだ当のタブにも届くため、writer IDで確実に除外する。
      if (next.storageWriterId === STORAGE_WRITER_ID) return;
      listener(next);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== `local:${LOCAL_KEY}` || !event.newValue) return;
    listener(JSON.parse(event.newValue) as LocalShape);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
