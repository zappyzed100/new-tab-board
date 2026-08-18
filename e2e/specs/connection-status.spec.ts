// connection-status.spec.ts — 各機能の「未接続/未設定」状態を常時可視化する回帰
// (ユーザー指示・2026-07-27「各機能未接続状態が見えるようにしよう」「共有フォルダを選択、
// GAS連携も可視化してほしい」)。
//
// 保管庫フォルダ/Gemini・OpenRouter APIキー/バッテリー低下警告(GAS連携)/Driveの共有フォルダ選択は、
// 以前はDataPanel内のローカルstateだけで持っていたため、パネルを開いて初めて未設定に
// 気づけた(Driveの既存の警告バッジと同じ問題——App.tsxのdriveConnectedのヘッダー参照)。
// 起動時にローカル読み(chrome.storage/IndexedDB。OAuthを伴わないので毎回確認してよい)で
// 判定し、未設定の間だけ控えめなバッジを常時表示する。押すとDataPanelが開く。
//
// 「共有フォルダを選択」は実際の選択操作(pickSharedFolderViaOAuth)が本物のGoogle認証を
// 伴うためE2Eでは実行できない——バッジの出現/消滅(IndexedDBへ直接値を書いて再現)だけを
// 検証し、選択操作自体の成功パスはE2E対象外(GDrive接続の成功パスと同じ既知の制約)。
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

/** IndexedDB(new-tab-board)のsettingsストアへ直接値を書く(実際のsetXxx関数と同じキー)。 */
async function seedSetting(page: Page, key: string, value: unknown) {
  await page.evaluate(
    ({ key, value }) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open("new-tab-board");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("settings", "readwrite");
          tx.objectStore("settings").put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { key, value },
  );
}

test("保管庫/AIキー/バッテリーが未設定なら、パネルを開く前からバッジが見える", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 折りたたみ式のDataPanelは閉じたまま(トグルを一度も押していない)——それでもバッジは見える。
  await expect(page.getByTestId("data-panel")).toHaveCount(0);
  await expect(page.getByTestId("nas-unconfigured-badge")).toBeVisible();
  await expect(page.getByTestId("gemini-unconfigured-badge")).toBeVisible();
  await expect(page.getByTestId("openrouter-unconfigured-badge")).toBeVisible();
  await expect(page.getByTestId("battery-unconfigured-badge")).toBeVisible();
  await expect(page.getByTestId("drive-shared-folder-unchosen-badge")).toBeVisible();

  // 押すとデータ操作パネルが開き、該当欄が見える。
  await page.getByTestId("gemini-unconfigured-badge").click();
  await expect(page.getByTestId("data-panel")).toBeVisible();
  await expect(page.getByTestId("data-set-gemini-key")).toBeVisible();
});

test("設定済みのものはバッジが出ない(平常時に雑音を足さない)", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await seedSetting(page, "nasFolderPath", "Z:\\保管庫\\backup");
  await seedSetting(page, "geminiApiKey", "dummy-key");
  await seedSetting(page, "openrouterApiKey", "dummy-key");
  await seedSetting(page, "batteryWebhookConfig", { url: "https://example.com", token: "t" });
  await seedSetting(page, "driveSharedFolderChosen", true);
  await page.reload();
  await expect(page.getByTestId("app-root")).toBeVisible();

  await expect(page.getByTestId("nas-unconfigured-badge")).toHaveCount(0);
  await expect(page.getByTestId("gemini-unconfigured-badge")).toHaveCount(0);
  await expect(page.getByTestId("openrouter-unconfigured-badge")).toHaveCount(0);
  await expect(page.getByTestId("battery-unconfigured-badge")).toHaveCount(0);
  await expect(page.getByTestId("drive-shared-folder-unchosen-badge")).toHaveCount(0);
});

test("共有フォルダを選択済みならバッジが出ない(未実行なら見える)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.getByTestId("drive-shared-folder-unchosen-badge")).toBeVisible();

  await seedSetting(page, "driveSharedFolderChosen", true);
  await page.reload();
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.getByTestId("drive-shared-folder-unchosen-badge")).toHaveCount(0);
});

test("Gemini APIキーを保存すると、リロードなしでバッジが消える", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.getByTestId("gemini-unconfigured-badge")).toBeVisible();

  await page.getByTestId("toggle-data-panel").click();
  await page.getByTestId("data-set-gemini-key").click();
  await page.getByTestId("data-gemini-key-input").fill("test-api-key");
  await page.getByTestId("data-save-gemini-key").click();
  await expect(page.getByTestId("data-panel-message")).toContainText(
    "Gemini APIキーを保存しました",
  );

  await expect(page.getByTestId("gemini-unconfigured-badge")).toHaveCount(0);
});

test("OpenRouter APIキーを保存すると、リロードなしでバッジが消える", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.getByTestId("openrouter-unconfigured-badge")).toBeVisible();

  await page.getByTestId("toggle-data-panel").click();
  await page.getByTestId("data-set-openrouter-key").click();
  const geometry = await page.evaluate(() => {
    const rect = (testId: string) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
    };
    const button = rect("data-set-openrouter-key");
    const input = rect("data-openrouter-key-input");
    const save = rect("data-save-openrouter-key");
    const overlaps = (a: typeof button, b: typeof input) =>
      a !== null &&
      b !== null &&
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top;
    return {
      controlsVisible: button !== null && input !== null && save !== null,
      noButtonInputOverlap: !overlaps(button, input),
      noInputSaveOverlap: !overlaps(input, save),
    };
  });
  expect(geometry).toEqual({
    controlsVisible: true,
    noButtonInputOverlap: true,
    noInputSaveOverlap: true,
  });
  await page.getByTestId("data-openrouter-key-input").fill("sk-or-v1-test");
  await page.getByTestId("data-save-openrouter-key").click();
  await expect(page.getByTestId("data-panel-message")).toContainText(
    "OpenRouter APIキーを保存しました",
  );

  await expect(page.getByTestId("openrouter-unconfigured-badge")).toHaveCount(0);
});

test("バッテリー通知の接続設定を保存すると、リロードなしでバッジが消える", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.getByTestId("battery-unconfigured-badge")).toBeVisible();

  await page.getByTestId("toggle-data-panel").click();
  await page.getByTestId("data-set-battery-webhook").click();
  await page.getByTestId("data-battery-url-input").fill("https://script.google.com/macros/x");
  await page.getByTestId("data-battery-token-input").fill("shared-token");
  await page.getByTestId("data-save-battery-webhook").click();
  await expect(page.getByTestId("data-panel-message")).toContainText(
    "バッテリー低下警告の接続設定を保存しました",
  );

  await expect(page.getByTestId("battery-unconfigured-badge")).toHaveCount(0);
});
