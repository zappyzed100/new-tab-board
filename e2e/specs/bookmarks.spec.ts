// bookmarks.spec.ts — ブックマークグリッドの追加/編集/削除E2E(SPEC.md §4.1)
import { expect, test } from "../fixtures";

test("ブックマークの追加→編集→削除が一連で動く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // --- 追加(URLだけ貼り付ける。名称はホスト名から自動で付く) ---
  await page.getByTestId("bookmark-add").click();
  await page.getByTestId("bookmark-add-form-url").fill("https://example.com");
  await page.getByTestId("bookmark-add-form-save").click();
  await expect(page.getByTestId("bookmark-grid")).toContainText("example.com");

  // --- 編集(URLだけ貼り替える。名称は新しいホスト名から自動で付け直る) ---
  await page.locator('[data-testid^="bookmark-edit-"]').click();
  const urlInput = page.locator('[data-testid^="bookmark-edit-form-"][data-testid$="-url"]');
  await urlInput.fill("https://example.org");
  await page.locator('[data-testid^="bookmark-edit-form-"][data-testid$="-save"]').click();
  await expect(page.getByTestId("bookmark-grid")).toContainText("example.org");

  // --- 削除 ---
  await page.locator('[data-testid^="bookmark-remove-"]').click();
  await expect(page.getByTestId("bookmark-grid")).not.toContainText("example.org");
});
