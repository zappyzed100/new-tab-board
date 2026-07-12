// board.spec.ts — golden path E2E: ブックマーク追加→ノート編集→履歴確認(SPEC.md準拠。M9)
import { expect, test } from "../fixtures";

test("ブックマーク追加→ノート編集→履歴保存の一連が動く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // --- ブックマーク追加(URLだけ貼り付ける。名称はホスト名から自動で付く) ---
  await page.getByTestId("bookmark-add").click();
  await page.getByTestId("bookmark-add-form-url").fill("https://example.com");
  await page.getByTestId("bookmark-add-form-save").click();
  await expect(page.getByTestId("bookmark-grid")).toContainText("example.com");

  // --- ノート編集(起動直後から末尾空3つが並ぶボード。先頭=左上のノートへ書く) ---
  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  await expect(firstPane.locator('[data-testid="notepad-editor"]')).toBeVisible();
  await firstPane.locator(".cm-content").click();
  await page.keyboard.type("こんにちは");
  await expect(firstPane.locator(".cm-content")).toHaveText("こんにちは");

  // --- 履歴保存(blurイベントでアイドル待ちを避け即時スナップショットを発火) ---
  // 履歴トグルはペイン(ノート)ごとにtestidが振られる(`toggle-history-<noteId>`)ため
  // 先頭ペインのものを開く。
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await firstPane.locator('[data-testid^="toggle-history-"]').click();
  await expect(page.getByTestId("history-panel")).toBeVisible();
  await expect(page.locator('[data-testid^="history-item-"]').first()).toBeVisible();
});
