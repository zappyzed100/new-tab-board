// storage.test.ts — storage.ts(chrome.storage⇔localStorageフォールバック)の単体テスト
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadLocalData,
  loadSyncData,
  saveLocalData,
  saveSyncData,
} from "./storage";

function stubChromeStorage() {
  const syncStore: Record<string, unknown> = {};
  const localStore: Record<string, unknown> = {};
  const removedSyncKeys: string[] = [];
  const syncGet = vi.fn(async (key: string) => ({ [key]: syncStore[key] }));
  vi.stubGlobal("chrome", {
    storage: {
      sync: {
        get: syncGet,
        set: async (items: Record<string, unknown>) => Object.assign(syncStore, items),
        remove: async (key: string) => {
          removedSyncKeys.push(key);
          delete syncStore[key];
        },
      },
      local: {
        get: async (key: string) => ({ [key]: localStore[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(localStore, items),
      },
    },
  });
  return { syncStore, localStore, removedSyncKeys, syncGet };
}

describe("chrome.storage が使える場合", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("local領域へ保存した内容を読み戻せる(syncは使わない)", async () => {
    const { syncStore } = stubChromeStorage();

    const data = { bookmarks: [], appLaunches: [], settings: DEFAULT_SETTINGS };
    await saveSyncData(data);
    expect(await loadSyncData()).toEqual(data);
    expect(syncStore.syncData).toBeUndefined(); // syncには一切書かない
  });

  it(
    "旧chrome.storage.syncに残っていたデータは初回読み込みでlocalへ引き継がれ、" +
      "syncからは削除される(2026-07-18: 8KB/item上限でブックマークが消えた実害を受けた移行)",
    async () => {
      const { syncStore, localStore, removedSyncKeys, syncGet } = stubChromeStorage();
      const legacy = {
        bookmarks: [
          {
            id: "b1",
            url: "https://example.com",
            label: "Example",
            icon: { type: "favicon" as const },
            order: 0,
          },
        ],
        appLaunches: [],
        settings: DEFAULT_SETTINGS,
      };
      syncStore.syncData = legacy;

      expect(await loadSyncData()).toEqual(legacy);
      expect(localStore.syncData).toEqual(legacy); // localへ引き継がれた
      expect(removedSyncKeys).toEqual(["syncData"]); // 旧syncエントリは掃除される

      // 2回目の読み込みはlocalから読むだけで、既に消えたsyncを見に行かない
      syncGet.mockClear();
      expect(await loadSyncData()).toEqual(legacy);
      expect(syncGet).not.toHaveBeenCalled();
    },
  );

  it("書き込み失敗はエラーを再送出する(呼び出し側が診断できるよう無音にしない)", async () => {
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: undefined }),
          set: async () => {
            throw new Error("QUOTA_BYTES_PER_ITEM quota exceeded");
          },
        },
        sync: {
          get: async (key: string) => ({ [key]: undefined }),
        },
      },
    });

    await expect(
      saveSyncData({ bookmarks: [], appLaunches: [], settings: DEFAULT_SETTINGS }),
    ).rejects.toThrow("quota exceeded");
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

  it(
    "既定のタグ候補は空でない(ユーザー指示: dist取得直後から候補が入っている状態にする——" +
      "GitHub全リポジトリのREADMEから選定・2026-07-17)",
    () => {
      expect(DEFAULT_SETTINGS.tagCandidates?.length ?? 0).toBeGreaterThan(0);
    },
  );
});
