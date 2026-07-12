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

  // --- 全文検索: ノート1の検索語がヒットする(検索バーは全ノート横断で常時表示) ---
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
  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  await firstPane.locator(".cm-content").click();
  await page.keyboard.type("明日は高尾山へ登山に行く予定");

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

  // 共通ワードを含むノートを2件用意する。
  await colFirst(0).locator(".cm-content").click();
  await page.keyboard.type("りんごジュースの作り方");
  await colFirst(1).locator(".cm-content").click();
  await page.keyboard.type("りんごを買う");

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
