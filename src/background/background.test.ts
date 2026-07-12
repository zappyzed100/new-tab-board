// background.test.ts — background.ts(サービスワーカー: Calendar定期ポーリング+予定前アラーム)の単体テスト
//
// background.tsはモジュール読み込み時に chrome.runtime.onInstalled 等へリスナーを登録する
// (SPEC.md §4.9・§4.11)。読み込み前にfakeのchromeグローバルを用意してからdynamic importし、
// 登録されたリスナー関数を捕まえておく——以降の各テストでは新しいfake chromeへ差し替えてから
// 同じリスナー関数を呼び出す(リスナー本体は呼び出し時点のグローバルchromeを参照するため、
// 差し替えるだけで新しい記録用配列/storageに向けて動作する)。
// getAuthToken/fetchNextEventは外部I/O(OAuth・Calendar API)のためvi.mockでフェイクに差し替える
// (AGENTS.md §9.5 非決定/外部I/Oの検疫と同じ設計)。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthToken } from "../lib/drive/googleAuth";
import { fetchNextEvent } from "../lib/nextEvent/calendar";
import { getNasFolderPath } from "../lib/storage/db";
import { rebuildNasIndex } from "../lib/externalIO/nasNativeHost";
import { copyNotesToDriveDateFolder } from "../lib/drive/driveActiveMirror";
import type { LocalData } from "../types";

vi.mock("../lib/drive/googleAuth", () => ({ getAuthToken: vi.fn() }));
vi.mock("../lib/nextEvent/calendar", () => ({ fetchNextEvent: vi.fn() }));
vi.mock("../lib/storage/db", () => ({ getNasFolderPath: vi.fn() }));
vi.mock("../lib/externalIO/nasNativeHost", () => ({ rebuildNasIndex: vi.fn() }));
vi.mock("../lib/drive/driveActiveMirror", () => ({ copyNotesToDriveDateFolder: vi.fn() }));

const FIXED_NOW = 1_700_000_000_000;
const POLL_ALARM_NAME = "next-event-poll";
const PRE_EVENT_ALARM_NAME = "pre-event-alarm";
const DAILY_ALARM_NAME = "daily-maintenance";
const NOTIFICATION_ID = "pre-event-notification";

// background.ts の dayKey / previousDayMs と同じローカル日付計算(TZに依らず一致する)。
const TODAY_KEY = (() => {
  const d = new Date(FIXED_NOW);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
})();
const YESTERDAY_MS = (() => {
  const d = new Date(FIXED_NOW);
  d.setDate(d.getDate() - 1);
  return d.getTime();
})();

type Handlers = {
  onInstalled: () => void;
  onStartup: () => void;
  onAlarm: (alarm: { name: string }) => void;
  onButtonClicked: (notificationId: string) => void;
  onMessage: (message: { type?: string }) => void;
};

const handlers = {} as Handlers;

function makeFakeChrome(initialStore: Record<string, unknown> = {}) {
  const store = { ...initialStore };
  const calls = {
    alarmsCreate: [] as { name: string; opts: unknown }[],
    alarmsClear: [] as string[],
    notificationsCreate: [] as { id: string; opts: Record<string, unknown> }[],
    notificationsClear: [] as string[],
    offscreenCreate: [] as unknown[],
    offscreenCloseCount: 0,
  };
  let hasOffscreenDoc = false;

  const chromeStub = {
    runtime: {
      onInstalled: { addListener: (fn: () => void) => (handlers.onInstalled = fn) },
      onStartup: { addListener: (fn: () => void) => (handlers.onStartup = fn) },
      onMessage: {
        addListener: (fn: (m: { type?: string }) => void) => (handlers.onMessage = fn),
      },
    },
    alarms: {
      onAlarm: {
        addListener: (fn: (a: { name: string }) => void) => (handlers.onAlarm = fn),
      },
      create: (name: string, opts: unknown) => calls.alarmsCreate.push({ name, opts }),
      clear: async (name: string) => {
        calls.alarmsClear.push(name);
        return true;
      },
    },
    notifications: {
      onButtonClicked: {
        addListener: (fn: (id: string) => void) => (handlers.onButtonClicked = fn),
      },
      create: (id: string, opts: Record<string, unknown>) =>
        calls.notificationsCreate.push({ id, opts }),
      clear: (id: string) => calls.notificationsClear.push(id),
    },
    offscreen: {
      Reason: { AUDIO_PLAYBACK: "AUDIO_PLAYBACK" },
      createDocument: async (opts: unknown) => {
        calls.offscreenCreate.push(opts);
        hasOffscreenDoc = true;
      },
      closeDocument: async () => {
        calls.offscreenCloseCount++;
        hasOffscreenDoc = false;
      },
      hasDocument: async () => hasOffscreenDoc,
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => Object.assign(store, items),
      },
    },
  };
  return { chromeStub, calls, store };
}

/** モックしたPromise群(getAuthToken/fetchNextEvent/chrome.storage等)が解決するまで
 * マイクロタスクキューを回す。実タイマーは使わない(test-sleep対策)。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

beforeAll(async () => {
  const initial = makeFakeChrome();
  vi.stubGlobal("chrome", initial.chromeStub);
  vi.stubGlobal("window", { __TIME_FREEZE__: FIXED_NOW });
  await import("./background");
});

beforeEach(() => {
  vi.stubGlobal("window", { __TIME_FREEZE__: FIXED_NOW });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("インストール/起動", () => {
  it("onInstalledで定期ポーリング用アラームと日次メンテ用アラームを作成する", () => {
    const fake = makeFakeChrome();
    vi.stubGlobal("chrome", fake.chromeStub);
    handlers.onInstalled();
    expect(fake.calls.alarmsCreate).toContainEqual({
      name: POLL_ALARM_NAME,
      opts: { periodInMinutes: 15 },
    });
    expect(fake.calls.alarmsCreate).toContainEqual({
      name: DAILY_ALARM_NAME,
      opts: { periodInMinutes: 60 },
    });
  });

  it("onStartupでも同じポーリング用アラームを作成する", () => {
    const fake = makeFakeChrome();
    vi.stubGlobal("chrome", fake.chromeStub);
    handlers.onStartup();
    expect(fake.calls.alarmsCreate).toContainEqual({
      name: POLL_ALARM_NAME,
      opts: { periodInMinutes: 15 },
    });
  });
});

describe("daily-maintenance アラーム(前日Drive格納 + SQLite再生成・一日一回)", () => {
  it("日付が変わっていれば前日フォルダへDrive格納しSQLite再生成し、実行日を記録する", async () => {
    const fake = makeFakeChrome({ localData: { notes: [{ id: "n1", content: "本文" }] } });
    vi.stubGlobal("chrome", fake.chromeStub);
    vi.mocked(getAuthToken).mockResolvedValue("token-abc");
    vi.mocked(getNasFolderPath).mockResolvedValue("Z:\\NAS\\backup");
    vi.mocked(copyNotesToDriveDateFolder).mockResolvedValue({ dated: 1 });
    vi.mocked(rebuildNasIndex).mockResolvedValue({ notes: 1, snapshots: 0 });

    handlers.onAlarm({ name: DAILY_ALARM_NAME });
    await flushMicrotasks();

    // Drive: 前日フォルダ(YESTERDAY_MS)へ現在のノートを格納。
    expect(copyNotesToDriveDateFolder).toHaveBeenCalledWith(
      [{ id: "n1", content: "本文" }],
      YESTERDAY_MS,
      "token-abc",
    );
    // NAS: SQLite索引を再生成。
    expect(rebuildNasIndex).toHaveBeenCalledWith("Z:\\NAS\\backup");
    // 実行日を記録(同日の二重実行を防ぐガード)。
    expect((fake.store.localData as LocalData).lastDailyMaintenanceDay).toBe(TODAY_KEY);
  });

  it("同じ日には二重実行しない(lastDailyMaintenanceDayが今日なら何もしない)", async () => {
    const fake = makeFakeChrome({
      localData: { notes: [{ id: "n1", content: "本文" }], lastDailyMaintenanceDay: TODAY_KEY },
    });
    vi.stubGlobal("chrome", fake.chromeStub);
    vi.mocked(getAuthToken).mockResolvedValue("token-abc");
    vi.mocked(getNasFolderPath).mockResolvedValue("Z:\\NAS\\backup");

    handlers.onAlarm({ name: DAILY_ALARM_NAME });
    await flushMicrotasks();

    expect(copyNotesToDriveDateFolder).not.toHaveBeenCalled();
    expect(rebuildNasIndex).not.toHaveBeenCalled();
  });

  it("Drive未接続(token無し)でもSQLite再生成は実行する(2つは独立)", async () => {
    const fake = makeFakeChrome({ localData: { notes: [{ id: "n1", content: "本文" }] } });
    vi.stubGlobal("chrome", fake.chromeStub);
    vi.mocked(getAuthToken).mockResolvedValue(null); // 未接続
    vi.mocked(getNasFolderPath).mockResolvedValue("Z:\\NAS\\backup");
    vi.mocked(rebuildNasIndex).mockResolvedValue({ notes: 1, snapshots: 0 });

    handlers.onAlarm({ name: DAILY_ALARM_NAME });
    await flushMicrotasks();

    expect(copyNotesToDriveDateFolder).not.toHaveBeenCalled();
    expect(rebuildNasIndex).toHaveBeenCalledWith("Z:\\NAS\\backup");
    expect((fake.store.localData as LocalData).lastDailyMaintenanceDay).toBe(TODAY_KEY);
  });

  it("NAS未設定でもDrive格納は実行する(2つは独立)", async () => {
    const fake = makeFakeChrome({ localData: { notes: [{ id: "n1", content: "本文" }] } });
    vi.stubGlobal("chrome", fake.chromeStub);
    vi.mocked(getAuthToken).mockResolvedValue("token-abc");
    vi.mocked(getNasFolderPath).mockResolvedValue(undefined); // NAS未設定
    vi.mocked(copyNotesToDriveDateFolder).mockResolvedValue({ dated: 1 });

    handlers.onAlarm({ name: DAILY_ALARM_NAME });
    await flushMicrotasks();

    expect(copyNotesToDriveDateFolder).toHaveBeenCalled();
    expect(rebuildNasIndex).not.toHaveBeenCalled();
    expect((fake.store.localData as LocalData).lastDailyMaintenanceDay).toBe(TODAY_KEY);
  });
});

describe("next-event-poll アラーム", () => {
  it("予定を取得してnextEventCacheへ保存し、予定前アラームをスケジュールする", async () => {
    const fake = makeFakeChrome();
    vi.stubGlobal("chrome", fake.chromeStub);
    const startsAt = FIXED_NOW + 30 * 60_000;
    vi.mocked(getAuthToken).mockResolvedValue("token-abc");
    vi.mocked(fetchNextEvent).mockResolvedValue({ title: "MTG", startsAt });

    handlers.onAlarm({ name: POLL_ALARM_NAME });
    await flushMicrotasks();

    const saved = fake.store.localData as LocalData;
    expect(saved.nextEventCache).toEqual({ title: "MTG", startsAt, fetchedAt: FIXED_NOW });
    expect(fake.calls.alarmsCreate).toContainEqual({
      name: PRE_EVENT_ALARM_NAME,
      opts: { when: startsAt - 10 * 60_000 },
    });
  });

  it("予定が無ければキャッシュを消し、予定前アラームもクリアする", async () => {
    const fake = makeFakeChrome({
      localData: { notes: [], nextEventCache: { title: "旧", startsAt: 0, fetchedAt: 0 } },
    });
    vi.stubGlobal("chrome", fake.chromeStub);
    vi.mocked(getAuthToken).mockResolvedValue("token-abc");
    vi.mocked(fetchNextEvent).mockResolvedValue(null);

    handlers.onAlarm({ name: POLL_ALARM_NAME });
    await flushMicrotasks();

    const saved = fake.store.localData as LocalData;
    expect(saved.nextEventCache).toBeUndefined();
    expect(fake.calls.alarmsClear).toContain(PRE_EVENT_ALARM_NAME);
  });

  it("未サインイン(token無し)なら何も保存せず静かに終わる", async () => {
    const fake = makeFakeChrome();
    vi.stubGlobal("chrome", fake.chromeStub);
    vi.mocked(getAuthToken).mockResolvedValue(null);

    handlers.onAlarm({ name: POLL_ALARM_NAME });
    await flushMicrotasks();

    expect(fetchNextEvent).not.toHaveBeenCalled();
    expect(fake.store.localData).toBeUndefined();
  });

  it("Calendar取得が例外を投げても握りつぶしクラッシュしない", async () => {
    const fake = makeFakeChrome();
    vi.stubGlobal("chrome", fake.chromeStub);
    vi.mocked(getAuthToken).mockResolvedValue("token-abc");
    vi.mocked(fetchNextEvent).mockRejectedValue(new Error("network down"));

    handlers.onAlarm({ name: POLL_ALARM_NAME });
    await flushMicrotasks();

    expect(fake.store.localData).toBeUndefined();
    expect(fake.calls.alarmsClear).toEqual([]);
  });
});

describe("pre-event-alarm アラーム(発火/停止)", () => {
  it("発火するとalarmActiveを立て、offscreenドキュメントと停止ボタン付き通知を作る", async () => {
    const fake = makeFakeChrome({ localData: { notes: [] } });
    vi.stubGlobal("chrome", fake.chromeStub);

    handlers.onAlarm({ name: PRE_EVENT_ALARM_NAME });
    await flushMicrotasks();

    const saved = fake.store.localData as LocalData;
    expect(saved.alarmActive).toBe(true);
    expect(fake.calls.offscreenCreate).toHaveLength(1);
    expect(fake.calls.notificationsCreate).toEqual([
      {
        id: NOTIFICATION_ID,
        opts: expect.objectContaining({
          buttons: [{ title: "停止" }],
          requireInteraction: true,
        }),
      },
    ]);
  });

  it("通知の停止ボタンでoffscreenを閉じ、通知を消し、alarmActiveをfalseにする", async () => {
    const fake = makeFakeChrome({ localData: { notes: [], alarmActive: true } });
    vi.stubGlobal("chrome", fake.chromeStub);
    // 発火時と同様に鳴動中の状態(offscreenドキュメントあり)を作ってから停止させる
    handlers.onAlarm({ name: PRE_EVENT_ALARM_NAME });
    await flushMicrotasks();

    handlers.onButtonClicked(NOTIFICATION_ID);
    await flushMicrotasks();

    expect(fake.calls.offscreenCloseCount).toBe(1);
    expect(fake.calls.notificationsClear).toContain(NOTIFICATION_ID);
    expect((fake.store.localData as LocalData).alarmActive).toBe(false);
  });

  it("new-tab側からのstop-pre-event-alarmメッセージでも同様に停止する", async () => {
    const fake = makeFakeChrome({ localData: { notes: [], alarmActive: true } });
    vi.stubGlobal("chrome", fake.chromeStub);
    handlers.onAlarm({ name: PRE_EVENT_ALARM_NAME });
    await flushMicrotasks();

    handlers.onMessage({ type: "stop-pre-event-alarm" });
    await flushMicrotasks();

    expect(fake.calls.offscreenCloseCount).toBe(1);
    expect((fake.store.localData as LocalData).alarmActive).toBe(false);
  });

  it("無関係な通知ID/メッセージ種別では反応しない", async () => {
    const fake = makeFakeChrome({ localData: { notes: [], alarmActive: true } });
    vi.stubGlobal("chrome", fake.chromeStub);

    handlers.onButtonClicked("other-notification");
    handlers.onMessage({ type: "something-else" });
    await flushMicrotasks();

    expect(fake.calls.offscreenCloseCount).toBe(0);
    expect(fake.calls.notificationsClear).toEqual([]);
  });
});
