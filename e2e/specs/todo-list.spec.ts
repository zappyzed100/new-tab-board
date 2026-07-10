// todo-list.spec.ts — 単体TODOリストのE2E(ノート本文からは独立。TodoMVC相当)
import { expect, test } from "../fixtures";

test("TODOの追加→完了切替→削除が一連で動く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.getByTestId("todo-list")).toBeVisible();

  // --- 追加(Enterで確定) ---
  await page.getByTestId("todo-new-input").fill("牛乳を買う");
  await page.getByTestId("todo-new-input").press("Enter");
  await expect(page.getByTestId("todo-list")).toContainText("牛乳を買う");
  await expect(page.getByTestId("todo-new-input")).toHaveValue("");

  // --- 完了切替 ---
  const toggle = page.locator('[data-testid^="todo-toggle-"]');
  await toggle.click();
  await expect(page.locator('[data-testid^="todo-item-"]')).toHaveClass(/todo-done/);

  // --- 削除 ---
  await page.locator('[data-testid^="todo-remove-"]').click();
  await expect(page.getByTestId("todo-list")).not.toContainText("牛乳を買う");
});
