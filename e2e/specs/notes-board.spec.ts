// notes-board.spec.ts — ノートボード(実測masonry)の回帰(2026-07-13にユーザー選択「最密」へ変更)
// ノートは全件を1枚のボードで常時表示し、App.tsxが各ペインの実高さを測って order(優先度)順に
// 「その時点で一番低い列」へ入れて縦積みする(最密詰め)。旧「i%列数で列固定」から変更。
// 検証の重心: ①列は横に並び重ならない②列内はgap詰めで縦に重ならない③列高さがほぼ揃う(最密の証拠)
// ④ピンで左上へ⑤一つ上へ⑥ドラッグ交換⑦末尾に常に空3つ。
import { expect, test } from "../fixtures";

// ノートタブは撤去済み。ノート名はペイン先頭の枠なし見出し(.note-pane-title-input の value)で持つ。
// 実測masonryは列配置を高さで決めるため i%列数 では順序を復元できない——各セルの data-linear-index
// (order列での位置)で論理的な並び順を読む。
const noteTitlesLinear = async (page: import("@playwright/test").Page): Promise<string[]> => {
  const pairs = await page.locator(".note-cell[data-linear-index]").evaluateAll((cells) =>
    cells.map((c) => ({
      idx: Number(c.getAttribute("data-linear-index")),
      title: (c.querySelector(".note-pane-title-input") as HTMLInputElement | null)?.value ?? "",
    })),
  );
  return pairs.sort((a, b) => a.idx - b.idx).map((p) => p.title);
};

// ノート数(=ペイン数)。
const panes = (page: import("@playwright/test").Page) =>
  page.locator('[data-testid^="note-editor-area-"]');

// 指定した列に属するノートペインのlocator。
const columnPanes = (page: import("@playwright/test").Page, col: number) =>
  page.locator(`[data-testid="note-column-${col}"] [data-testid^="note-editor-area-"]`);

test("実測masonry: 列は重ならず・列内はgap詰め・列高さがほぼ揃う(最密)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 }); // 3列に十分な幅
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 先頭ノートへ大量の行を入れて「とても縦に長い」ノートを1つ作る(→末尾空も補充され複数ノートになる)。
  await columnPanes(page, 0).first().locator(".cm-content").click();
  await page.keyboard.type("長いノート\n".repeat(40));
  // さらに短いノートを数個増やして masonry を働かせる(空を非空化すると末尾へ空が補充される)。
  for (let i = 0; i < 3; i++) {
    const empty = page.locator('[data-testid^="note-editor-area-"]').last();
    await empty.locator(".cm-content").click();
    await page.keyboard.type(`短${i}`);
  }
  await expect.poll(async () => panes(page).count()).toBeGreaterThanOrEqual(5);

  // 各列の「全ペインのrect」を取り、実測で不変条件を検証する(CLAUDE.md: 目視でなく数値で)。
  const colCount = await page.locator('[data-testid^="note-column-"]').count();
  const columns: { top: number; bottom: number; left: number; right: number }[][] = [];
  for (let c = 0; c < colCount; c++) {
    columns.push(
      await columnPanes(page, c).evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        }),
      ),
    );
  }
  const nonEmptyCols = columns.filter((col) => col.length > 0);
  expect(nonEmptyCols.length).toBeGreaterThanOrEqual(2); // 複数列に分散している

  // ① 隣り合う列は横に並んで重ならない(左の列の右端 ≤ 右の列の左端)。
  for (let c = 0; c + 1 < columns.length; c++) {
    if (columns[c].length === 0 || columns[c + 1].length === 0) continue;
    const leftRight = Math.max(...columns[c].map((r) => r.right));
    const rightLeft = Math.min(...columns[c + 1].map((r) => r.left));
    expect(leftRight).toBeLessThanOrEqual(rightLeft + 1);
  }

  // ② 列内はgap詰めで縦に重ならない(各ペインの上端 ≥ 前ペインの下端。かつ隙間は詰まっている)。
  for (const col of columns) {
    for (let i = 1; i < col.length; i++) {
      expect(col[i].top).toBeGreaterThanOrEqual(col[i - 1].bottom - 1); // 重ならない
      expect(col[i].top).toBeLessThan(col[i - 1].bottom + 40); // 真下に詰め上がる(gap程度)
    }
  }

  // ③ 最密の証拠: 列の高さがほぼ揃う。列の下端(最下ペインのbottom)のばらつきが、
  //    一番高い単一ノートの高さ未満に収まる(=全部を1列に積まず最短列へ分散している)。
  const colBottoms = nonEmptyCols.map((col) => Math.max(...col.map((r) => r.bottom)));
  const colTops = nonEmptyCols.map((col) => Math.min(...col.map((r) => r.top)));
  const tallestNote = Math.max(...columns.flat().map((r) => r.bottom - r.top));
  const spread = Math.max(...colBottoms) - Math.min(...colBottoms);
  // greedy(最短列詰め)のバランス保証: 列高さの差は最大ノート高さ未満。長いノート1本を
  // 単純にi%で置く旧方式では、その列だけ tallestNote 以上に突出してこの条件を破っていた。
  expect(spread).toBeLessThan(tallestNote);
  // 列の上端は揃っている(全列 flex-start 上端揃え)。
  expect(Math.max(...colTops) - Math.min(...colTops)).toBeLessThan(2);
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
