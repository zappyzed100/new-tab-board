// notes-board.spec.ts — ノートボード(列固定masonry)の回帰(2026-07-12)
// ノートは全件を1枚のボードで常時表示し、order順に i%列数 で各列へ振り分けて縦積みする
// (ユーザー指示「列固定・安定」)。旧「横並び3件をチェックボックスで選ぶ」モデルは撤去。
// 検証の重心: ①長いノートで隣の列が引き伸ばされず、短いノートの真下に次が詰め上がる
// (flexの等高stretchへ回帰していない)②ピンで左上へ③一つ上へ④ドラッグ交換⑤末尾に常に空3つ。
import { expect, test } from "../fixtures";

const tabTitles = (page: import("@playwright/test").Page) =>
  page.locator('[data-testid^="note-tab-select-"]').allTextContents();

// 指定した列に属するノートペインのlocator。
const columnPanes = (page: import("@playwright/test").Page, col: number) =>
  page.locator(`[data-testid="note-column-${col}"] [data-testid^="note-editor-area-"]`);

const rectOf = (loc: import("@playwright/test").Locator) =>
  loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });

test("列固定masonry: 長いノートで隣の列が伸びず、短いノートの下に次が詰め上がる", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 }); // 3列に十分な幅
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 起動直後は末尾空3つ(ノートA/B/C)。masonryを見るため合計5件へ増やす(→3列: col0=2,col1=2,col2=1)。
  while ((await page.locator('[data-testid^="note-tab-select-"]').count()) < 5) {
    await page.getByTestId("note-tab-add").click();
  }
  await expect(page.getByTestId("note-column-0")).toBeVisible();
  await expect(page.getByTestId("note-column-2")).toBeVisible();
  await expect(columnPanes(page, 0)).toHaveCount(2);
  await expect(columnPanes(page, 1)).toHaveCount(2);
  await expect(columnPanes(page, 2)).toHaveCount(1);

  // col0の先頭ノートへ大量の行を入れて「とても縦に長い」状態を作る。
  await columnPanes(page, 0).first().locator(".cm-content").click();
  await page.keyboard.type("長いノート\n".repeat(40));

  const col0First = await rectOf(columnPanes(page, 0).first());
  const col1First = await rectOf(columnPanes(page, 1).first());
  const col1Second = await rectOf(columnPanes(page, 1).nth(1));

  // ① 列は横に並ぶ(col0の右端 ≤ col1の左端。重ならない)。
  expect(col0First.right).toBeLessThanOrEqual(col1First.left + 1);

  // ② 短いcol1の1件目は等高stretchせず自然高のまま(=col0の長いノートより明らかに低い)。
  expect(col1First.bottom).toBeLessThan(col0First.bottom - 100);

  // ③ col1の2件目は「1件目の真下」に詰め上がる(1件目の下端付近から始まる)。
  //    旧flex等高ではcol1の1件目がcol0に合わせて伸び、2件目はずっと下から始まっていた。
  expect(col1Second.top).toBeLessThan(col1First.bottom + 40);
  //    かつ、隣の長いノート(col0先頭)の下端より上から始まる(引きずられていない証拠)。
  expect(col1Second.top).toBeLessThan(col0First.bottom);
});

test("末尾には常に空ノートが3つ確保される(先頭を埋めると新しい空が末尾へ増える)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 起動直後は空ノートちょうど3つ(ノートA/B/C)。
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(3);

  // 先頭(左上)のノートに本文を入れると、末尾の空が2つに減るため1つ補充されて4つになる。
  await columnPanes(page, 0).first().locator(".cm-content").click();
  await page.keyboard.type("なにか書いた");
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(4);
});

test("ピン留めしたノートは最優先で左上(順序列の先頭)に来る", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(3);

  const before = await tabTitles(page); // [ノートA, ノートB, ノートC]
  const lastTitle = before[before.length - 1];

  // 末尾のノート(col2の先頭 = 3件中3番目)をピン留めする。
  await columnPanes(page, 2)
    .first()
    .getByTestId(/^pin-note-/)
    .click();

  // 順序列の先頭 = col0の先頭ペイン。そこが今ピンしたノート(旧末尾)になる。
  await expect.poll(async () => (await tabTitles(page))[0]).toBe(lastTitle);
});

test("「⬆️ 上へ」で順序列の1つ前のノートと入れ替わる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(3);

  const before = await tabTitles(page); // [A, B, C]
  // 2番目(col1の先頭)のノートを1つ上へ → 先頭と入れ替わる。
  await columnPanes(page, 1)
    .first()
    .getByTestId(/^move-note-up-/)
    .click();

  await expect.poll(async () => tabTitles(page)).toEqual([before[1], before[0], before[2]]);
});

test("先頭ノートの「⬆️ 上へ」は無効(これ以上上がない)", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(3);

  await expect(
    columnPanes(page, 0)
      .first()
      .getByTestId(/^move-note-up-/),
  ).toBeDisabled();
});

test("ドラッグつまみでノートの位置を入れ替えられる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(3);

  const before = await tabTitles(page); // [A, B, C]
  // 末尾ノート(col2先頭)のつまみを、先頭ノート(col0先頭)のつまみ(ヘッダ)へドラッグ → 末尾が先頭位置へ。
  // dropはCard全体で受けるが、中央(CodeMirrorエディタ上)へdropするとCM6がdropイベントを
  // 飲むため、エディタ外のヘッダ(つまみ)へ落とす(実ユーザーもヘッダ帯へ落とす想定)。
  const handleLast = columnPanes(page, 2).first().locator('[data-testid^="note-drag-handle-"]');
  const handleFirst = columnPanes(page, 0).first().locator('[data-testid^="note-drag-handle-"]');
  await handleLast.dragTo(handleFirst);

  await expect.poll(async () => (await tabTitles(page))[0]).toBe(before[2]);
});

test("ノートペイン先頭でノート名を編集するとタブにも反映される", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(3);

  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  await firstPane.locator(".note-pane-title input").fill("議事録");

  // 同じノートのタブ表示も新しい名前になる(タイトルはlinear orderで一意にひもづく)。
  await expect(
    page.locator('[data-testid^="note-tab-select-"]', { hasText: "議事録" }),
  ).toBeVisible();
});

test("ノートペインの🗑でそのノートを削除できる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(3);

  // 末尾補充で名前が復活しないよう、英字連番でない固有名に変えてから削除する。
  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  await firstPane.locator(".note-pane-title input").fill("削除対象テスト");
  await expect(
    page.locator('[data-testid^="note-tab-select-"]', { hasText: "削除対象テスト" }),
  ).toBeVisible();

  await firstPane.locator('[data-testid^="delete-note-"]').click();
  await expect(
    page.locator('[data-testid^="note-tab-select-"]', { hasText: "削除対象テスト" }),
  ).toHaveCount(0);
});

test("対応済みチェックでノートが淡色(data-done)になる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.locator('[data-testid^="note-tab-select-"]')).toHaveCount(3);

  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  await expect(firstPane).not.toHaveAttribute("data-done", "true");
  await firstPane.locator('[data-testid^="done-note-"]').click();
  await expect(firstPane).toHaveAttribute("data-done", "true");
});
