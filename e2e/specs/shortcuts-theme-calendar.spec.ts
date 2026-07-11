// shortcuts-theme-calendar.spec.ts — ショートカット一覧/テーマ切替/小型カレンダーのE2E(SPEC.md §4.6・§4.8・§4.9)
import { expect, test } from "../fixtures";

test("ショートカット一覧モーダルが開閉できる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await page.getByTestId("open-shortcuts-modal").click();
  await expect(page.getByTestId("shortcuts-modal")).toBeVisible();
  await expect(page.getByTestId("shortcuts-modal")).toContainText("全文検索を開く/閉じる");
  await page.getByTestId("shortcuts-modal-close").click();
  await expect(page.getByTestId("shortcuts-modal")).not.toBeVisible();
});

test("ショートカット一覧モーダルは外側クリックでも閉じる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await page.getByTestId("open-shortcuts-modal").click();
  await expect(page.getByTestId("shortcuts-modal")).toBeVisible();
  // Radix Dialogはoverlay(背景)をコンポーネント内部にカプセル化しており外部から
  // data-testidを付与できないため、Radix標準のoverlayクラスをセレクタに使う。
  await page.locator(".rt-DialogOverlay").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("shortcuts-modal")).not.toBeVisible();
});

test("テーマ切替がdocument.documentElementへ反映される", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // Radix Selectは独自のポップオーバー実装(ネイティブ<select>ではない)なので
  // selectOption()は使えず、トリガーをクリック→該当optionをクリックする形にする。
  await page.getByTestId("theme-select").click();
  await page.getByRole("option", { name: "ダーク" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByTestId("theme-select").click();
  await page.getByRole("option", { name: "ライト" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("小型カレンダーは常時表示され、前月/翌月に移動できる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // トグル不要(常時表示のサイドバーウィジェット)
  await expect(page.getByTestId("mini-calendar")).toBeVisible();
  const initialLabel = await page.getByTestId("calendar-month-label").textContent();

  await page.getByTestId("calendar-next-month").click();
  await expect(page.getByTestId("calendar-month-label")).not.toHaveText(initialLabel ?? "");

  await page.getByTestId("calendar-prev-month").click();
  await expect(page.getByTestId("calendar-month-label")).toHaveText(initialLabel ?? "");
});

test("データ管理は常時表示される", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // トグル不要(常時表示。ボタンを毎回押す手間を無くすため撤去した)。
  await expect(page.getByTestId("data-panel")).toBeVisible();
});
