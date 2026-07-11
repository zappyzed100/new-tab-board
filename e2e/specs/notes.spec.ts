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
  await expect(newTab).toContainText(/^ノート[A-Z]$/);

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

test("ノートタブはドラッグ&ドロップで並べ替えられる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 順序を判定しやすいよう2件追加する(既存タブが残っていても末尾2件で比較する)
  await page.getByTestId("note-tab-add").click();
  await page.getByTestId("note-tab-add").click();

  const selects = page.locator('[data-testid^="note-tab-select-"]');
  const count = await selects.count();
  const firstTitle = await selects.nth(count - 2).textContent();
  const secondTitle = await selects.nth(count - 1).textContent();

  const tabs = page.locator(".note-tab");
  await tabs.nth(count - 2).dragTo(tabs.nth(count - 1));

  await expect(selects.nth(count - 2)).toHaveText(secondTitle ?? "");
  await expect(selects.nth(count - 1)).toHaveText(firstTitle ?? "");
});

test("ダークモード時、ノート本文のカーソル色が黒固定にならずテーマに追従する", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // ノートが1件も無い初期状態でも動くよう、明示的に1件用意してから開く。
  await page.getByTestId("note-tab-add").click();
  await expect(page.locator('[data-testid="notepad-editor"]')).toBeVisible();

  await page.getByTestId("theme-select").click();
  await page.getByRole("option", { name: "ダーク" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.locator('[data-testid="notepad-editor"] .cm-content').click();

  const cursorColor = await page.evaluate(() => {
    const cursor = document.querySelector(".cm-cursor");
    return cursor ? getComputedStyle(cursor).borderLeftColor : null;
  });
  // CM6のネイティブキャレットはcaret-colorが常にblack固定でダークモードで見えなく
  // なるバグがあった(drawSelection()導入+.cm-cursorへのvar(--text)指定で修正)。
  // 黒(rgb(0, 0, 0))固定へ回帰していないことを確認する。
  expect(cursorColor).not.toBeNull();
  expect(cursorColor).not.toBe("rgb(0, 0, 0)");
});
