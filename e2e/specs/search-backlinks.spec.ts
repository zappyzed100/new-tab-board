// search-backlinks.spec.ts — 全文検索/バックリンクのE2E(SPEC.md §7 v1確定)
// 横断TODO集約機能は撤去済み(ユーザーフィードバックにより不要と判断)。
// ノートは3件以下なら全件が横並び表示される(SPEC.md §4.2)ため、このテストのように
// 2件同時に開いていると.cm-content等のセレクタが複数ヒットする。「現在アクティブな
// ペイン」(data-active="true")に絞り込むことで一意にする。
import { expect, test } from "../fixtures";

const ACTIVE_PANE = '[data-testid^="note-editor-area-"][data-active="true"]';

test("検索・バックリンクが連動して動く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // --- ノート1: 「会議メモ」— 検索語・[[買い物リスト]]へのリンクを含む ---
  await page.getByTestId("note-tab-add").click();
  const note1Tab = page.locator('[data-testid^="note-tab-select-"]').last();
  await note1Tab.dblclick();
  await page.locator('[data-testid^="note-tab-rename-input-"]').fill("会議メモ");
  await page.locator('[data-testid^="note-tab-rename-input-"]').blur();
  await page.locator(`${ACTIVE_PANE} .cm-content`).click();
  await page.keyboard.type("lookup keyword-xyz here\n[[買い物リスト]]");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));

  // --- ノート2: 「買い物リスト」(バックリンク先) ---
  await page.getByTestId("note-tab-add").click();
  const note2Tab = page.locator('[data-testid^="note-tab-select-"]').last();
  await note2Tab.dblclick();
  await page.locator('[data-testid^="note-tab-rename-input-"]').fill("買い物リスト");
  await page.locator('[data-testid^="note-tab-rename-input-"]').blur();

  // --- 全文検索: ノート1の検索語がヒットする(検索バーは全ノート横断で常時表示) ---
  await note1Tab.click();
  await expect(page.getByTestId("search-panel")).toBeVisible();
  await page.getByTestId("search-input").fill("keyword-xyz");
  await expect(page.locator('[data-testid^="search-result-open-"]')).toContainText("会議メモ");
  await page.getByTestId("search-input").fill("");

  // --- バックリンク: 「買い物リスト」に切り替えると「会議メモ」からのリンクが見える ---
  await note2Tab.click();
  await expect(page.locator(`${ACTIVE_PANE} [data-testid="backlinks-panel"]`)).toContainText(
    "会議メモ",
  );
});
