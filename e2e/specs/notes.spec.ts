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

test("ノート本文ペインは1行に最大3件までで、4件目以降は下の行へ折り返す", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  // 広い画面でも「3列まで」で頭打ちになることを検証したいので、4列入りうる幅にする。
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 5件以上のノートを用意する(横並び上限を撤廃したため4件超でも全て並べられる)。
  while ((await page.locator('[data-testid^="note-tab-select-"]').count()) < 5) {
    await page.getByTestId("note-tab-add").click();
  }
  // 表示チェックを5件オンにする(既定は先頭3件。4件以上のときだけチェックボックスが出る)。
  const checks = page.locator('[data-testid^="note-tab-visible-"]');
  const total = await checks.count();
  let checked = await page
    .locator('[data-testid^="note-tab-visible-"][data-state="checked"]')
    .count();
  for (let i = 0; i < total && checked < 5; i++) {
    const c = checks.nth(i);
    if ((await c.getAttribute("data-state")) !== "checked") {
      await c.click();
      checked += 1;
    }
  }
  const panes = page.locator('[data-testid^="note-editor-area-"]');
  await expect(panes).toHaveCount(5);

  // 各ペインのtop(=行)ごとの件数を数え、どの行も3件以下・5件なら2行以上に折り返すこと。
  const tops = await panes.evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().top)),
  );
  const perRow = new Map<number, number>();
  for (const t of tops) perRow.set(t, (perRow.get(t) ?? 0) + 1);
  expect(Math.max(...perRow.values())).toBeLessThanOrEqual(3);
  expect(perRow.size).toBeGreaterThanOrEqual(2);
});

test("下にスクロールしても、タブバーと全文検索のstickyヘッダは上端に留まる", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  // スクロールできる高さを確保するためノートを数件用意する(各ペインに最低高さがある)。
  while ((await page.locator('[data-testid^="note-tab-select-"]').count()) < 5) {
    await page.getByTestId("note-tab-add").click();
  }
  const head = page.getByTestId("note-sticky-head");
  await expect(head).toBeVisible();
  expect(await head.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");

  // 下へスクロールすると、stickyヘッダは視界上端(top≈0)に貼り付いて残る。
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect
    .poll(async () => head.evaluate((el) => Math.round(el.getBoundingClientRect().top)))
    .toBeLessThanOrEqual(1);
  const top = await head.evaluate((el) => Math.round(el.getBoundingClientRect().top));
  expect(top).toBeGreaterThanOrEqual(0);
});

test("A+/A−でノート本文の文字だけが拡縮し、他UIの文字サイズは変わらない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  while ((await page.locator('[data-testid^="note-tab-select-"]').count()) < 1) {
    await page.getByTestId("note-tab-add").click();
  }
  const fontPx = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  const beforeEditor = await fontPx('[data-testid="notepad-editor"] .cm-editor');
  const beforeTab = await fontPx('[data-testid^="note-tab-select-"]');

  await page.getByTestId("note-font-increase").click();
  // 反映を待つ: サイズ表示ラベルが増える
  await expect(page.getByTestId("note-font-size-value")).toHaveText(`${beforeEditor + 1}px`);

  const afterEditor = await fontPx('[data-testid="notepad-editor"] .cm-editor');
  const afterTab = await fontPx('[data-testid^="note-tab-select-"]');
  expect(afterEditor).toBeGreaterThan(beforeEditor); // ノート本文は大きくなる
  expect(afterTab).toBe(beforeTab); // ノート以外(タブ文字)のサイズは変わらない

  // 後始末: 元のサイズへ戻す(共有コンテキストのsync設定を汚さない)。
  await page.getByTestId("note-font-decrease").click();
  await expect(page.getByTestId("note-font-size-value")).toHaveText(`${beforeEditor}px`);
});

test("✨要約ボタンはGemini APIキー未設定なら案内を出し、勝手に実行しない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  while ((await page.locator('[data-testid^="note-tab-select-"]').count()) < 1) {
    await page.getByTestId("note-tab-add").click();
  }
  // E2Eプロファイルにはキーが無いので、要約を押すと案内メッセージが出る(外部API通信は起きない)。
  await page.locator('[data-testid^="summarize-"]').first().click();
  await expect(page.getByTestId("data-panel-message")).toContainText(
    "Gemini APIキーを設定してください",
  );
});

test("🏷️タグをふるボタンはGemini APIキー未設定なら案内を出す", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("tag-all-notes").click();
  await expect(page.getByTestId("data-panel-message")).toContainText(
    "Gemini APIキーを設定してください",
  );
});
