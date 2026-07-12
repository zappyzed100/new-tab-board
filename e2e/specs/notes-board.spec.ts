// notes-board.spec.ts — ノートボード(列固定masonry)の回帰(2026-07-12)
// ノートは全件を1枚のボードで常時表示し、order順に i%列数 で各列へ振り分けて縦積みする
// (ユーザー指示「列固定・安定」)。旧「横並び3件をチェックボックスで選ぶ」モデルは撤去。
// 検証の重心: ①長いノートで隣の列が引き伸ばされず、短いノートの真下に次が詰め上がる
// (flexの等高stretchへ回帰していない)②ピンで左上へ③一つ上へ④ドラッグ交換⑤末尾に常に空3つ。
import { expect, test } from "../fixtures";

// ノートタブは撤去済み。ノート名はペイン先頭の枠なし見出し(.note-pane-title-input の value)で持つ。
// 列固定masonry(order順を i%列数 で各列へ)から linear order(order順)を復元する:
// linear index i は col (i%列数) の row floor(i/列数)。
const noteTitlesLinear = async (page: import("@playwright/test").Page): Promise<string[]> => {
  const cols = await page.locator('[data-testid^="note-column-"]').count();
  const perCol: string[][] = [];
  for (let c = 0; c < cols; c++) {
    perCol[c] = await page
      .locator(`[data-testid="note-column-${c}"] .note-pane-title-input`)
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  }
  const result: string[] = [];
  const maxRows = Math.max(0, ...perCol.map((a) => a.length));
  for (let r = 0; r < maxRows; r++) {
    for (let c = 0; c < cols; c++) {
      if (perCol[c][r] !== undefined) result.push(perCol[c][r]);
    }
  }
  return result;
};

// ノート数(=ペイン数)。
const panes = (page: import("@playwright/test").Page) =>
  page.locator('[data-testid^="note-editor-area-"]');

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

  // 起動直後は末尾空3つ。ノートタブ(+追加)は撤去したので、先頭2ノートに文字を入れて増やす
  // (非空化するたび末尾へ空が1つ補充され、総数が 3→4→5 になる。→3列: col0=2,col1=2,col2=1)。
  for (const col of [0, 1]) {
    const n = await panes(page).count();
    await columnPanes(page, col).first().locator(".cm-content").click();
    await page.keyboard.type("x");
    await expect(panes(page)).toHaveCount(n + 1);
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
  await expect(panes(page)).toHaveCount(3);

  // 先頭(左上)のノートに本文を入れると、末尾の空が2つに減るため1つ補充されて4つになる。
  await columnPanes(page, 0).first().locator(".cm-content").click();
  await page.keyboard.type("なにか書いた");
  await expect(panes(page)).toHaveCount(4);
});

test("ピン留めしたノートは最優先で左上(順序列の先頭)に来る", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const before = await noteTitlesLinear(page); // [ノートA, ノートB, ノートC]
  const lastTitle = before[before.length - 1];

  // 末尾のノート(col2の先頭 = 3件中3番目)をピン留めする。
  await columnPanes(page, 2)
    .first()
    .getByTestId(/^pin-note-/)
    .click();

  // 順序列の先頭 = col0の先頭ペイン。そこが今ピンしたノート(旧末尾)になる。
  await expect.poll(async () => (await noteTitlesLinear(page))[0]).toBe(lastTitle);
});

test("「⬆️ 上へ」で順序列の1つ前のノートと入れ替わる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const before = await noteTitlesLinear(page); // [A, B, C]
  // 2番目(col1の先頭)のノートを1つ上へ → 先頭と入れ替わる。
  await columnPanes(page, 1)
    .first()
    .getByTestId(/^move-note-up-/)
    .click();

  await expect.poll(async () => noteTitlesLinear(page)).toEqual([before[1], before[0], before[2]]);
});

test("先頭ノートの「⬆️ 上へ」は無効(これ以上上がない)", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

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
  await expect(panes(page)).toHaveCount(3);

  const before = await noteTitlesLinear(page); // [A, B, C]
  // 末尾ノート(col2先頭)のつまみを掴み→先頭ノート(col0先頭)のヘッダへドロップ → 末尾が先頭位置へ。
  // ネイティブDnDのマウス擬似はPlaywrightで不安定なため、DnDイベントを直接dispatchして
  // ハンドラ(onDragStart=refに掴んだid / onDrop=refのidをその位置へ移動)を決定的に発火させる。
  const handleLast = columnPanes(page, 2).first().locator('[data-testid^="note-drag-handle-"]');
  const dropTargetFirst = columnPanes(page, 0)
    .first()
    .locator('[data-testid^="note-drag-handle-"]');
  await handleLast.dispatchEvent("dragstart");
  await dropTargetFirst.dispatchEvent("dragover");
  await dropTargetFirst.dispatchEvent("drop");

  await expect.poll(async () => (await noteTitlesLinear(page))[0]).toBe(before[2]);
});

test("ノートペイン先頭でノート名を編集できる(枠なし見出し・左上配置)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  const title = firstPane.locator(".note-pane-title-input");
  await title.fill("議事録");

  // 先頭ノートのタイトルが更新される(linear orderの先頭=議事録)。
  await expect.poll(async () => (await noteTitlesLinear(page))[0]).toBe("議事録");

  // レイアウト実測(CLAUDE.md): ①名前は一番左上=操作ボタン行(優先度)より上・左端が揃う
  // ②枠が見えない ③文字が大きい ④チェックとピンは名前と同じ行の右側・ピンはアイコンだけ(細い)。
  const titleBox = await title.boundingBox();
  const priorityBox = await firstPane.locator('[data-testid^="move-note-up-"]').boundingBox();
  const checkBox = await firstPane.locator('[data-testid^="check-note-"]').boundingBox();
  const pinBox = await firstPane.locator('[data-testid^="pin-note-"]').boundingBox();
  if (!titleBox || !priorityBox || !checkBox || !pinBox) {
    throw new Error("layout elements not visible");
  }
  // ①名前は操作ボタン行より上の行にあり、左端が揃う(＝一番左上)。
  expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(priorityBox.y + 1);
  expect(titleBox.x).toBeLessThanOrEqual(priorityBox.x + 4);
  // ②枠が見えない(borderの太さが0)。
  const border = await title.evaluate((el) => {
    const s = getComputedStyle(el);
    return { top: s.borderTopWidth, left: s.borderLeftWidth };
  });
  expect(border).toEqual({ top: "0px", left: "0px" });
  // ③文字は少し大きい(1.15rem ≈ 18px)。
  const titleFontPx = await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(titleFontPx).toBeGreaterThan(15);
  // ④チェックとピンは名前と同じ行(縦に重なる)で名前より右、ピンはチェックより右端側。
  const sameRow = (b: { y: number; height: number }) =>
    b.y < titleBox.y + titleBox.height && titleBox.y < b.y + b.height;
  expect(sameRow(checkBox) && sameRow(pinBox)).toBe(true);
  expect(checkBox.x).toBeGreaterThan(titleBox.x);
  expect(pinBox.x).toBeGreaterThan(checkBox.x);
  expect(pinBox.width).toBeLessThan(48); // ピンは説明なしのアイコンだけ=細い
});

test("ノートペインの🗑でそのノートを削除できる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  // 末尾補充で名前が復活しないよう、英字連番でない固有名に変えてから削除する。
  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  await firstPane.locator(".note-pane-title-input").fill("削除対象テスト");
  await expect.poll(async () => noteTitlesLinear(page)).toContain("削除対象テスト");

  await firstPane.locator('[data-testid^="delete-note-"]').click();
  await expect.poll(async () => noteTitlesLinear(page)).not.toContain("削除対象テスト");
});

test("ノート名の右のチェックはトグルできるが、ノートの見た目には連動しない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  const check = firstPane.locator('[data-testid^="check-note-"]');

  // 初期は未チェック。見た目に連動する属性(data-done)は廃止済みで付かない。
  await expect(check).toHaveAttribute("data-state", "unchecked");
  expect(await firstPane.getAttribute("data-done")).toBeNull();
  const opacityBefore = await firstPane.evaluate((el) => getComputedStyle(el).opacity);

  await check.click();
  // チェック状態はトグルされるが、ノートの透明度(見た目)は変わらない=何とも連動しない。
  await expect(check).toHaveAttribute("data-state", "checked");
  expect(await firstPane.getAttribute("data-done")).toBeNull();
  const opacityAfter = await firstPane.evaluate((el) => getComputedStyle(el).opacity);
  expect(opacityAfter).toBe(opacityBefore);
});

test("🧹初期化でノートの内容が空に戻る(削除とは違いノートは残る)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  await firstPane.locator(".cm-content").click();
  await page.keyboard.type("消される予定の本文");
  await expect(firstPane.locator(".cm-content")).toHaveText("消される予定の本文");
  const tabCount = await panes(page).count();

  await firstPane.locator('[data-testid^="reset-note-"]').click();
  // 本文はCM6ごと再マウントされて空になり、ノート数は減らない(削除ではない)。
  await expect(firstPane.locator(".cm-content")).toHaveText("");
  await expect(panes(page)).toHaveCount(tabCount);
});
