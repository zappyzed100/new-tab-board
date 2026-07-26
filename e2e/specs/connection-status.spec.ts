// connection-status.spec.ts — 各機能の「未接続/未設定」状態を常時可視化する回帰
// (ユーザー指示・2026-07-27「各機能未接続状態が見えるようにしよう」)。
//
// 保管庫フォルダ/Gemini APIキー/バッテリー低下警告の接続設定は、以前はDataPanel内の
// ローカルstateだけで持っていたため、パネルを開いて初めて未設定に気づけた
// (Driveの既存の警告バッジと同じ問題——App.tsxのdriveConnectedのヘッダー参照)。
// 起動時にローカル読み(chrome.storage/IndexedDB。OAuthを伴わないので毎回確認してよい)で
// 判定し、未設定の間だけ控えめなバッジを常時表示する。押すとDataPanelが開く。
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

test("保管庫/Gemini/バッテリーが未設定なら、パネルを開く前からバッジが見える", async ({
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
  await expect(page.getByTestId("battery-unconfigured-badge")).toBeVisible();

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
  await seedSetting(page, "batteryWebhookConfig", { url: "https://example.com", token: "t" });
  await page.reload();
  await expect(page.getByTestId("app-root")).toBeVisible();

  await expect(page.getByTestId("nas-unconfigured-badge")).toHaveCount(0);
  await expect(page.getByTestId("gemini-unconfigured-badge")).toHaveCount(0);
  await expect(page.getByTestId("battery-unconfigured-badge")).toHaveCount(0);
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
