// storage.test.ts — storage.ts(chrome.storage⇔localStorageフォールバック)の単体テスト
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadLocalData,
  loadSyncData,
  saveLocalData,
  saveSyncData,
} from "./storage";

describe("chrome.storage が使える場合", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sync領域へ保存した内容を読み戻せる", async () => {
    const store: Record<string, unknown> = {};
    vi.stubGlobal("chrome", {
      storage: {
        sync: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (items: Record<string, unknown>) => Object.assign(store, items),
        },
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (items: Record<string, unknown>) => Object.assign(store, items),
        },
      },
    });

    const data = { bookmarks: [], appLaunches: [], settings: DEFAULT_SETTINGS };
    await saveSyncData(data);
    expect(await loadSyncData()).toEqual(data);
  });
});

describe("chrome.storage が無い場合(localStorageフォールバック)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("localStorageへ保存した内容を読み戻せる", async () => {
    const backing = new Map<string, string>();
    vi.stubGlobal("chrome", undefined);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => backing.set(k, v),
      },
    });

    await saveLocalData({ notes: [] });
    expect(await loadLocalData()).toEqual({ notes: [] });
  });

  it("何も保存されていなければ既定値を返す", async () => {
    const backing = new Map<string, string>();
    vi.stubGlobal("chrome", undefined);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => backing.set(k, v),
      },
    });

    expect(await loadSyncData()).toEqual({
      bookmarks: [],
      appLaunches: [],
      settings: DEFAULT_SETTINGS,
    });
  });
});
