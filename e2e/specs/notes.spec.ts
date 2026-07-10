// notes.spec.ts — ノートタブの追加/リネーム/削除E2E(SPEC.md §4.2)
// ピン留めのUIは撤去済み(メモ帳アプリ風に追加=+/削除=×のみのタブへ簡素化)。
import { expect, test } from "../fixtures";

test("ノートタブの追加→リネーム→削除が一連で動く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const beforeCount = await page.locator('[data-testid^="note-tab-select-"]').count();

  // --- 追加 ---
  await page.getByTestId("note-tab-add").click();
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(beforeCount + 1);
  const newTab = page.locator('[data-testid^="note-tab-select-"]').last();
  await expect(newTab).toContainText("無題のノート");

  // --- リネーム(ダブルクリックで入力欄に切替→blurで確定) ---
  await newTab.dblclick();
  const renameInput = page.locator('[data-testid^="note-tab-rename-input-"]');
  await renameInput.fill("会議メモ");
  await renameInput.blur();
  await expect(page.locator('[data-testid^="note-tab-select-"]').last()).toContainText("会議メモ");

  // --- 削除(タブ上の×) ---
  await page.locator('[data-testid^="note-tab-delete-"]').last().click();
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(beforeCount);
});
