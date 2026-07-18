// data-panel-battery.spec.ts — スマホのバッテリー低下警告(GAS Web App中継)接続設定UIの回帰
// (契約はgas/README.md。ユーザー指示: New Tab Boardにバッテリー低下警告を出したい)。
// 「GAS連携を設定」ボタン(ユーザー指示で「バッテリー警告を設定」から改称。2026-07-16)を
// 押した時だけ入力欄が出る(NAS設定と同じパターン)。
import { expect, test } from "../fixtures";

test("「GAS連携を設定」を押すまで入力欄は表示されない", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  await expect(page.getByTestId("data-battery-url-input")).toHaveCount(0);

  await page.getByTestId("data-set-battery-webhook").click();

  await expect(page.getByTestId("data-battery-url-input")).toBeVisible();
  await expect(page.getByTestId("data-battery-token-input")).toBeVisible();
  await expect(page.getByTestId("data-save-battery-webhook")).toBeVisible();
});

test("URL・トークンのどちらかが空欄なら保存を試みず案内する", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  await page.getByTestId("data-set-battery-webhook").click();
  await page
    .getByTestId("data-battery-url-input")
    .fill("https://script.google.com/macros/s/xxx/exec");
  // トークン未入力のまま保存。
  await page.getByTestId("data-save-battery-webhook").click();

  await expect(page.getByTestId("data-panel-message")).toContainText(
    "GAS Web AppのURLと共有トークンの両方を入力してください",
  );
});

test("URL・トークン両方入力すると保存でき、ボタンに「設定済み」が付く", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  await page.getByTestId("data-set-battery-webhook").click();
  await page
    .getByTestId("data-battery-url-input")
    .fill("https://script.google.com/macros/s/xxx/exec");
  await page.getByTestId("data-battery-token-input").fill("secret-token");
  await page.getByTestId("data-save-battery-webhook").click();

  await expect(page.getByTestId("data-panel-message")).toContainText(
    "バッテリー低下警告の接続設定を保存しました",
  );
  // 保存すると入力欄は閉じ、ボタンに「設定済み」が付く。
  await expect(page.getByTestId("data-battery-url-input")).toHaveCount(0);
  await expect(page.getByTestId("data-set-battery-webhook")).toContainText("設定済み");

  // 再度開くとURLは復元されるが、トークン欄は空(秘匿情報を画面に出さない)。
  await page.getByTestId("data-set-battery-webhook").click();
  await expect(page.getByTestId("data-battery-url-input")).toHaveValue(
    "https://script.google.com/macros/s/xxx/exec",
  );
  await expect(page.getByTestId("data-battery-token-input")).toHaveValue("");
});
