// bookmarks.spec.ts — ブックマークグリッドの追加/編集/削除E2E(SPEC.md §4.1)
import { expect, test } from "./fixtures";

test("ブックマークの追加→編集→削除が一連で動く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // --- 追加 ---
  await page.getByTestId("bookmark-add").click();
  await page.getByTestId("bookmark-add-form-url").fill("https://example.com");
  await page.getByTestId("bookmark-add-form-label").fill("サンプル");
  await page.getByTestId("bookmark-add-form-save").click();
  await expect(page.getByTestId("bookmark-grid")).toContainText("サンプル");

  // --- 編集 ---
  await page.locator('[data-testid^="bookmark-edit-"]').click();
  const labelInput = page.locator('[data-testid$="-label"]').last();
  await labelInput.fill("サンプル改");
  await page.locator('[data-testid$="-save"]').last().click();
  await expect(page.getByTestId("bookmark-grid")).toContainText("サンプル改");

  // --- 削除 ---
  await page.locator('[data-testid^="bookmark-remove-"]').click();
  await expect(page.getByTestId("bookmark-grid")).not.toContainText("サンプル改");
});
