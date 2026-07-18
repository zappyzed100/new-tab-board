// search-backlinks.spec.ts — 全文検索/バックリンクのE2E(SPEC.md §7 v1確定)
// ノートタブは撤去済み。全件がボード(列固定masonry)で常時表示されるため、ノート名は
// ペイン先頭の見出し(.note-pane-title-input)で編集し、対象は列の先頭ペインで名指しする
// (DOMは列単位で並ぶため、linear先頭2件=col0/col1の先頭ペイン)。
import { expect, test } from "../fixtures";

test("検索・バックリンクが連動して動く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 }); // 3列に十分な幅
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const colFirst = (c: number) =>
    page.locator(`[data-testid="note-column-${c}"] [data-testid^="note-editor-area-"]`).first();

  // --- ノート1「会議メモ」: 検索語 + [[買い物リスト]]へのリンクを含む ---
  await colFirst(0).locator(".note-pane-title-input").fill("会議メモ");
  await colFirst(0).locator(".cm-content").click();
  await page.keyboard.type("lookup keyword-xyz here\n[[買い物リスト]]");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));

  // --- ノート2「買い物リスト」(バックリンク先)。別の列の先頭ノートをリネームして用意する ---
  await colFirst(1).locator(".note-pane-title-input").fill("買い物リスト");

  // --- 全文検索: ノート1の検索語がヒットする(検索バーは折りたたみ式なのでまず開く) ---
  await page.getByTestId("toggle-search-panel").click();
  await expect(page.getByTestId("search-panel")).toBeVisible();
  await page.getByTestId("search-input").fill("keyword-xyz");
  await expect(page.locator('[data-testid^="search-result-open-"]')).toContainText("会議メモ");
  await page.getByTestId("search-input").fill("");

  // --- バックリンク: 「買い物リスト」ノートのバックリンク欄に「会議メモ」が出る ---
  // (バックリンクが無いノートはパネルを描画しないため、描画される唯一のパネルが買い物リスト用)。
  await expect(page.getByTestId("backlinks-panel").filter({ hasText: "会議メモ" })).toBeVisible();
});

test("全文検索は現在の本文の部分文字列(日本語)でヒットする", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 先頭の空ノートへ日本語の1文を書く(履歴に刻む前=書いた直後でも引けることを確かめる)。
  // 検索パネルはこの後で開く——先に開くと、lazyロード中の検索欄autoFocusがノートへの
  // 入力中にフォーカスを奪い、入力が一部欠落することがある(2026-07-18に実際踏んだ)。
  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  await firstPane.locator(".cm-content").click();
  await page.keyboard.type("明日は高尾山へ登山に行く予定");

  await page.getByTestId("toggle-search-panel").click();
  // 連続日本語の「一部」で検索してヒットする(旧転置索引は完全一致のみで引けなかった)。
  await page.getByTestId("search-input").fill("高尾山");
  await expect(page.getByTestId("search-result-count")).toContainText("1件");
  await expect(page.locator('[data-testid^="search-result-open-"]').first()).toContainText(
    "高尾山",
  );
});

test("全文検索の結果が複数あっても重ならず縦に並ぶ", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  const colFirst = (c: number) =>
    page.locator(`[data-testid="note-column-${c}"] [data-testid^="note-editor-area-"]`).first();

  // 共通ワードを含むノートを2件用意する(検索パネルを開くのはこの後——理由は
  // 「日本語部分文字列」テストのコメント参照)。
  await colFirst(0).locator(".cm-content").click();
  await page.keyboard.type("りんごジュースの作り方");
  await colFirst(1).locator(".cm-content").click();
  await page.keyboard.type("りんごを買う");

  await page.getByTestId("toggle-search-panel").click();
  await page.getByTestId("search-input").fill("りんご");
  const results = page.locator('[data-testid^="search-result-open-"]');
  await expect(results).toHaveCount(2);

  // 2つの結果の矩形が縦に重なっていない(上の下端 ≤ 下の上端)。Radix Button固定高による重なりの回帰防止。
  const boxes = await results.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }),
  );
  boxes.sort((a, b) => a.top - b.top);
  expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top + 1);
});

test("Cmd/Ctrl+Rで置換欄が開き、選択した対象ノートだけに一括置換できる", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  const colFirst = (c: number) =>
    page.locator(`[data-testid="note-column-${c}"] [data-testid^="note-editor-area-"]`).first();

  // 共通ワードを含むノートを2件用意する(検索パネルを開くのはこの後)。
  await colFirst(0).locator(".cm-content").click();
  await page.keyboard.type("りんごジュースの作り方");
  await colFirst(1).locator(".cm-content").click();
  await page.keyboard.type("りんごを買う");
  const id0 = await colFirst(0).getAttribute("data-testid");
  const id1 = await colFirst(1).getAttribute("data-testid");

  await page.getByTestId("toggle-search-panel").click();
  await page.getByTestId("search-input").fill("りんご");
  await expect(page.getByTestId("search-result-count")).toContainText("2件");

  // 置換欄はCmd/Ctrl+Rで開く(既存の全文検索の拡張・ユーザー指示)。
  await expect(page.getByTestId("replace-section")).toHaveCount(0);
  await page.keyboard.press("Control+r");
  await expect(page.getByTestId("replace-section")).toBeVisible();
  await expect(page.getByTestId("replace-input")).toBeFocused();

  // 既定で全ヒットが対象選択されている。1件だけチェックを外す。
  const targetCheckboxes = page.locator('[data-testid^="replace-target-"]');
  await expect(targetCheckboxes).toHaveCount(2);

  // UI/CSS変更は数値でも重なり無しを確認する(CLAUDE.md規約)。検索欄と置換トグルボタンが
  // 横に並んで重ならない・チェックボックス付きの結果2件が縦に重ならないことを実測する。
  const searchInputBox = await page.getByTestId("search-input").boundingBox();
  const replaceToggleBox = await page.getByTestId("replace-toggle").boundingBox();
  if (!searchInputBox || !replaceToggleBox) throw new Error("search row not visible");
  expect(searchInputBox.x + searchInputBox.width).toBeLessThanOrEqual(replaceToggleBox.x + 1);
  const resultBoxes = await page.locator('[data-testid^="search-result-"]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }),
  );
  resultBoxes.sort((a, b) => a.top - b.top);
  expect(resultBoxes[0].bottom).toBeLessThanOrEqual(resultBoxes[1].top + 1);

  await page.getByTestId(`replace-target-${id1!.replace("note-editor-area-", "")}`).click();

  await page.getByTestId("replace-input").fill("みかん");
  await page.getByTestId("replace-apply").click();
  await expect(page.getByTestId("replace-result-message")).toContainText("1件");

  // チェックを外さなかった方(id0)だけ本文が置換され、外した方(id1)は元のまま。
  await expect(page.locator(`[data-testid="${id0}"] .cm-content`)).toContainText(
    "みかんジュースの作り方",
  );
  await expect(page.locator(`[data-testid="${id1}"] .cm-content`)).toContainText("りんごを買う");
});
