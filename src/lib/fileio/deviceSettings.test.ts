// deviceSettings.test.ts — 端末ローカル設定のローカルファイル持ち出し/取り込みの単体テスト。
// db.ts(IndexedDB)はvi.mockで差し替える(実DBを開かない)。
import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, unknown> = {};

vi.mock("../storage/db", () => ({
  getNasFolderPath: vi.fn(async () => store.nasFolderPath as string | undefined),
  setNasFolderPath: vi.fn(async (path: string) => {
    store.nasFolderPath = path;
  }),
  getBatteryWebhookConfig: vi.fn(async () => store.batteryWebhookConfig),
  setBatteryWebhookConfig: vi.fn(async (config: unknown) => {
    store.batteryWebhookConfig = config;
  }),
  getAlarmEnabled: vi.fn(async () => (store.alarmEnabled ?? true) as boolean),
  setAlarmEnabled: vi.fn(async (enabled: boolean) => {
    store.alarmEnabled = enabled;
  }),
  getDriveFolderIds: vi.fn(async () => (store.driveFolderIds ?? {}) as Record<string, string>),
  saveDriveFolderId: vi.fn(async (path: string, id: string) => {
    store.driveFolderIds = { ...((store.driveFolderIds ?? {}) as object), [path]: id };
  }),
  getDriveSharedFolderChosen: vi.fn(async () => Boolean(store.driveSharedFolderChosen)),
  getOpenRouterApiKey: vi.fn(async () => store.openrouterApiKey as string | undefined),
  setDriveSharedFolderChosen: vi.fn(async () => {
    store.driveSharedFolderChosen = true;
  }),
  setOpenRouterApiKey: vi.fn(async (key: string) => {
    store.openrouterApiKey = key;
  }),
}));

const { applyDeviceSettings, parseDeviceSettings, readDeviceSettings } =
  await import("./deviceSettings");
const { buildSettingsBackupPayload } = await import("./settingsBackup");

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe("readDeviceSettings", () => {
  it("端末ローカル設定(保管庫パス/AIキー/GAS連携/Driveフォルダ/共有フォルダ選択済み)を読み出す", async () => {
    store.nasFolderPath = "Z:\\保管庫";
    store.openrouterApiKey = "sk-or-v1-テスト";
    store.batteryWebhookConfig = { url: "https://script.google.com/x", token: "tok" };
    store.driveFolderIds = { app: "folder-1" };
    store.driveSharedFolderChosen = true;

    expect(await readDeviceSettings()).toEqual({
      nasFolderPath: "Z:\\保管庫",
      openrouterApiKey: "sk-or-v1-テスト",
      batteryWebhookConfig: { url: "https://script.google.com/x", token: "tok" },
      alarmEnabled: true,
      driveFolderIds: { app: "folder-1" },
      driveSharedFolderChosen: true,
    });
  });

  it("未設定の項目はキーごと省く(取り込み側で「触らない」と区別できるようにするため)", async () => {
    const settings = await readDeviceSettings();

    expect(settings).not.toHaveProperty("nasFolderPath");
    expect(settings).not.toHaveProperty("openrouterApiKey");
    expect(settings).not.toHaveProperty("batteryWebhookConfig");
    // 1件も無いフォルダIDは空オブジェクトでなく欠落させる。
    expect(settings).not.toHaveProperty("driveFolderIds");
  });
});

describe("applyDeviceSettings", () => {
  it("読み出した内容をそのまま書き戻せる(往復で同じになる)", async () => {
    await applyDeviceSettings({
      nasFolderPath: "Z:\\復元先",
      openrouterApiKey: "sk-or-v1-復元",
      batteryWebhookConfig: { url: "https://script.google.com/y", token: "tok2" },
      alarmEnabled: false,
      driveFolderIds: { app: "f1", "app/New Tab Board": "f2" },
      driveSharedFolderChosen: true,
    });

    expect(await readDeviceSettings()).toEqual({
      nasFolderPath: "Z:\\復元先",
      openrouterApiKey: "sk-or-v1-復元",
      batteryWebhookConfig: { url: "https://script.google.com/y", token: "tok2" },
      alarmEnabled: false,
      driveFolderIds: { app: "f1", "app/New Tab Board": "f2" },
      driveSharedFolderChosen: true,
    });
  });

  it("欠落している項目は現状維持する(古い版のファイルで設定済みの値を潰さない)", async () => {
    store.openrouterApiKey = "既存キー";
    store.nasFolderPath = "Z:\\既存";

    await applyDeviceSettings({ nasFolderPath: "Z:\\新しい" });

    expect(store.nasFolderPath).toBe("Z:\\新しい");
    expect(store.openrouterApiKey).toBe("既存キー");
  });
});

describe("parseDeviceSettings", () => {
  it("想定外の形は無視してundefinedを返す(設定本体の取り込みを巻き添えにしない)", () => {
    expect(parseDeviceSettings(undefined)).toBeUndefined();
    expect(parseDeviceSettings(null)).toBeUndefined();
    expect(parseDeviceSettings("文字列")).toBeUndefined();
    expect(parseDeviceSettings([1, 2])).toBeUndefined();
  });

  it("型の合わない項目だけを落とし、正しい項目は残す", () => {
    expect(
      parseDeviceSettings({
        nasFolderPath: 123,
        openrouterApiKey: "sk-or-v1-ok",
        batteryWebhookConfig: { url: "https://x", token: 5 },
        driveFolderIds: { app: "id", bad: 7 },
        driveSharedFolderChosen: "true",
      }),
    ).toEqual({
      openrouterApiKey: "sk-or-v1-ok",
      driveFolderIds: { app: "id" },
    });
  });
});

describe("秘匿情報の境界", () => {
  it("保管庫/Driveへ自動で上がる設定バックアップには端末ローカル設定を含めない(db.tsの方針の要)", () => {
    const payload = buildSettingsBackupPayload(
      {
        bookmarks: [],
        appLaunches: [],
        settings: {
          openIn: "same",
          theme: "dark",
          searchEngine: "https://www.google.com/search?q=%s",
        },
      },
      { todos: [], specialItems: [], specialFolders: [] },
      0,
    );

    // ここにdeviceSettingsが混ざると、APIキーが自動同期でクラウドへ出てしまう。
    expect(payload).not.toHaveProperty("deviceSettings");
    expect(JSON.stringify(payload)).not.toContain("openrouterApiKey");
  });
});
