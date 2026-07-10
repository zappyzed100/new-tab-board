// data-panel.spec.ts — データ管理パネルのJSON書き出し/取り込みE2E(SPEC.md §4.7)
import { expect, test } from "./fixtures";

test("JSONエクスポート→インポートで全データが復元される", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // --- 復元対象のデータを用意する ---
  await page.getByTestId("bookmark-add").click();
  await page.getByTestId("bookmark-add-form-url").fill("https://example.com");
  await page.getByTestId("bookmark-add-form-label").fill("サンプル");
  await page.getByTestId("bookmark-add-form-save").click();
  await expect(page.getByTestId("bookmark-grid")).toContainText("サンプル");

  // --- エクスポート ---
  await page.getByTestId("toggle-data").click();
  await expect(page.getByTestId("data-panel")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("data-export-json").click();
  const download = await downloadPromise;
  const exportPath = await download.path();
  expect(exportPath).toBeTruthy();

  // --- 別データへ入れ替えてからインポートし、元のブックマークが復元されることを確認する ---
  await page.locator('[data-testid^="bookmark-remove-"]').click();
  await expect(page.getByTestId("bookmark-grid")).not.toContainText("サンプル");

  await page.getByTestId("data-import-file-input").setInputFiles(exportPath!);
  await expect(page.getByTestId("data-panel-message")).toContainText("インポートしました");
  await expect(page.getByTestId("bookmark-grid")).toContainText("サンプル");
});
