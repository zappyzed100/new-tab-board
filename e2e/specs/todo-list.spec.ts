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

test("タグ候補はTODOリストの下で追加・削除でき、永続する", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const todo = await page.getByTestId("todo-list").boundingBox();
  const panel = await page.getByTestId("tag-candidates-panel").boundingBox();
  if (!todo || !panel) throw new Error("panels not visible");
  // TODOリストの下に配置される(上端がTODOリストの下端以降)。
  expect(panel.y).toBeGreaterThanOrEqual(todo.y + todo.height - 1);

  // 追加(Enter)。
  await page.getByTestId("tag-candidate-input").fill("LLMへの指示");
  await page.getByTestId("tag-candidate-input").press("Enter");
  await expect(page.getByTestId("tag-candidate-list")).toContainText("LLMへの指示");
  await page.getByTestId("tag-candidate-input").fill("コーディング");
  await page.getByTestId("tag-candidate-input").press("Enter");
  await expect(page.getByTestId("tag-candidate-list")).toContainText("コーディング");

  // 再読み込みしても残る(設定=chrome.storage.syncに保存される)。
  await page.reload();
  await expect(page.getByTestId("tag-candidate-list")).toContainText("LLMへの指示");
  await expect(page.getByTestId("tag-candidate-list")).toContainText("コーディング");

  // 削除。
  await page.getByTestId("tag-candidate-remove-コーディング").click();
  await expect(page.getByTestId("tag-candidate-list")).not.toContainText("コーディング");
  await expect(page.getByTestId("tag-candidate-list")).toContainText("LLMへの指示");
});
