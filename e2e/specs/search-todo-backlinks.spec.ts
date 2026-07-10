// search-todo-backlinks.spec.ts — 全文検索/横断TODO/バックリンクのE2E(SPEC.md §7 v1確定)
import { expect, test } from "../fixtures";

test("検索・TODO集約・バックリンクが連動して動く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // --- ノート1: 「会議メモ」— TODO行・検索語・[[買い物リスト]]へのリンクを含む ---
  await page.getByTestId("note-tab-add").click();
  const note1Tab = page.locator('[data-testid^="note-tab-select-"]').last();
  await note1Tab.dblclick();
  await page.locator('[data-testid^="note-tab-rename-input-"]').fill("会議メモ");
  await page.locator('[data-testid^="note-tab-rename-input-"]').blur();
  await page.locator(".cm-content").click();
  await page.keyboard.type("- [ ] 買い出しに行く\nlookup keyword-xyz here\n[[買い物リスト]]");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));

  // --- ノート2: 「買い物リスト」(バックリンク先) ---
  await page.getByTestId("note-tab-add").click();
  const note2Tab = page.locator('[data-testid^="note-tab-select-"]').last();
  await note2Tab.dblclick();
  await page.locator('[data-testid^="note-tab-rename-input-"]').fill("買い物リスト");
  await page.locator('[data-testid^="note-tab-rename-input-"]').blur();

  // --- 全文検索: ノート1の検索語がヒットする ---
  await page.getByTestId("toggle-search").click();
  await expect(page.getByTestId("search-panel")).toBeVisible();
  await page.getByTestId("search-input").fill("keyword-xyz");
  await expect(page.locator('[data-testid^="search-result-open-"]')).toContainText("会議メモ");
  await page.getByTestId("toggle-search").click();

  // --- TODO一覧: 未完了のTODOが集約される ---
  await page.getByTestId("toggle-todos").click();
  await expect(page.getByTestId("todo-panel")).toContainText("買い出しに行く");
  await page.getByTestId("toggle-todos").click();

  // --- バックリンク: 「買い物リスト」に切り替えると「会議メモ」からのリンクが見える ---
  await note2Tab.click();
  await expect(page.getByTestId("backlinks-panel")).toContainText("会議メモ");
});
