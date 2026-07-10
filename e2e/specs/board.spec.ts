// board.spec.ts — golden path E2E: ブックマーク追加→ノート編集→履歴確認(SPEC.md準拠。M9)
import { expect, test } from "../fixtures";

test("ブックマーク追加→ノート編集→履歴保存の一連が動く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // --- ブックマーク追加 ---
  await page.getByTestId("bookmark-add").click();
  await page.getByTestId("bookmark-add-form-url").fill("https://example.com");
  await page.getByTestId("bookmark-add-form-label").fill("サンプル");
  await page.getByTestId("bookmark-add-form-save").click();
  await expect(page.getByTestId("bookmark-grid")).toContainText("サンプル");

  // --- ノート追加 + 編集 ---
  await page.getByTestId("note-tab-add").click();
  await expect(page.getByTestId("notepad-editor")).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.type("こんにちは");
  await expect(page.locator(".cm-content")).toHaveText("こんにちは");

  // --- 履歴保存(blurイベントでアイドル待ちを避け即時スナップショットを発火) ---
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.getByTestId("toggle-history").click();
  await expect(page.getByTestId("history-panel")).toBeVisible();
  await expect(page.locator('[data-testid^="history-item-"]').first()).toBeVisible();
});
