// command-palette.spec.ts — コマンドパレット(Cmd+K)のE2E(SPEC.md §4.5)
import { expect, test } from "../fixtures";

test("コマンドパレットでノートを検索して切り替えられる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 切替先を用意するため、ノートを2つ作る
  await page.getByTestId("note-tab-add").click();
  const firstTab = page.locator('[data-testid^="note-tab-select-"]').last();
  await firstTab.dblclick();
  await page.locator('[data-testid^="note-tab-rename-input-"]').fill("買い物リスト");
  await page.locator('[data-testid^="note-tab-rename-input-"]').blur();

  await page.getByTestId("note-tab-add").click();
  const secondTab = page.locator('[data-testid^="note-tab-select-"]').last();
  await secondTab.dblclick();
  await page.locator('[data-testid^="note-tab-rename-input-"]').fill("旅行計画");
  await page.locator('[data-testid^="note-tab-rename-input-"]').blur();

  // --- コマンドパレットを開いて絞り込み検索 ---
  await page.getByTestId("open-command-palette").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.getByTestId("command-palette-input").fill("買い物");
  await expect(page.getByTestId("command-palette-list")).toContainText("買い物リスト");
  await expect(page.getByTestId("command-palette-list")).not.toContainText("旅行計画");

  await page.locator('[data-testid^="command-palette-run-note-"]').click();
  await expect(page.getByTestId("command-palette")).not.toBeVisible();
  await expect(
    page.locator('[aria-current="true"][data-testid^="note-tab-select-"]'),
  ).toContainText("買い物リスト");
});
