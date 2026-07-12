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

test("ノート編集エリアはフォーカスが外れた状態から本文の下の余白をクリックしても入力できる", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await page.getByTestId("note-tab-add").click();
  const editor = page.locator('[data-testid="notepad-editor"]');
  await expect(editor).toBeVisible();

  // CM6のクリック→カーソル移動処理は.cm-content(contenteditable本体)にしか効かない。
  // .cm-content/.cm-scrollerが本文の行数分の高さ(1行分)にしかならず枠いっぱいに
  // 広がっていないと、本文より下の余白は裸の.cm-scroller/.cm-editorがクリックを
  // 受けることになり、フォーカスが外れた状態からは何も起きない(クリックしても
  // 入力できない)バグがあった。
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  // 全文検索バーが常時表示になった分ページが縦に伸びるため、素のmouse.clickで
  // 座標指定する前にビューポート内へ確実にスクロールしておく(要素はscrollIntoView
  // されるが、生座標クリックは自動スクロールしない)。
  await editor.scrollIntoViewIfNeeded();
  const box = await editor.boundingBox();
  if (!box) throw new Error("notepad-editor is not visible");
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.9);
  await page.keyboard.type("X");

  await expect(page.getByTestId("notepad-status-bar")).toHaveText("行 1、列 2、1文字/全1文字");
});
