// search-backlinks.spec.ts — 全文検索/バックリンクのE2E(SPEC.md §7 v1確定)
// 横断TODO集約機能は撤去済み(ユーザーフィードバックにより不要と判断)。
// ノートは全件がボード表示される(列固定masonry)+末尾に常に空3つが補充されるため、
// タブは `.last()` では狙えない(本文を書くと末尾へ新しい空が増える)。タブはタイトルで
// 名指しし、編集対象ペインは「現在アクティブなペイン」(data-active="true")で一意にする。
import { expect, test } from "../fixtures";

const ACTIVE_PANE = '[data-testid^="note-editor-area-"][data-active="true"]';

test("検索・バックリンクが連動して動く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const tabByTitle = (title: string) =>
    page.locator('[data-testid^="note-tab-select-"]', { hasText: title });

  // --- ノート1: 「会議メモ」— 検索語・[[買い物リスト]]へのリンクを含む ---
  // 起動直後の末尾空ノート(ノートA)をダブルクリックしてリネームする(新規追加せず既存の空を使う)。
  await page.locator('[data-testid^="note-tab-select-"]').first().dblclick();
  await page.locator('[data-testid^="note-tab-rename-input-"]').fill("会議メモ");
  await page.locator('[data-testid^="note-tab-rename-input-"]').blur();
  await tabByTitle("会議メモ").click();
  await page.locator(`${ACTIVE_PANE} .cm-content`).click();
  await page.keyboard.type("lookup keyword-xyz here\n[[買い物リスト]]");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));

  // --- ノート2: 「買い物リスト」(バックリンク先)。別の空ノートをリネームして用意する ---
  await tabByTitle("ノートB").dblclick();
  await page.locator('[data-testid^="note-tab-rename-input-"]').fill("買い物リスト");
  await page.locator('[data-testid^="note-tab-rename-input-"]').blur();
  const note1Tab = tabByTitle("会議メモ");
  const note2Tab = tabByTitle("買い物リスト");

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
