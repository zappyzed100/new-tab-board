// fixed-tags.spec.ts — 固定タグモード(ユーザー指示・2026-07-25)の回帰。
// プリセット(名前付きタグの組)を選ぶと、①盤面はそのタグを全て持つノートだけになり
// ②編集を終えたノートの本文末尾へ不足分の `#タグ` が入り ③空ノートには何も付かない。
// 付与はblurでしか起きない(CM6はcontentをマウント時にしか読まない)ため、実際に打鍵して
// フォーカスを外す経路で固定する。
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const panes = (page: Page) => page.locator('[data-testid^="note-editor-area-"]');

/** 指定ペインへ打鍵し、タイトル欄をクリックしてblurする(=編集終了。固定タグはここで付く)。 */
async function typeAndBlur(page: Page, pane: ReturnType<Page["locator"]>, text: string) {
  await pane.locator(".cm-content").click();
  await page.keyboard.type(text);
  await pane.locator(".note-pane-title-input").click();
}

/** 固定タグのプリセットを登録して選択する。 */
async function activatePreset(page: Page, name: string, tags: string) {
  await page.getByTestId("fixed-tag-edit-toggle").click();
  await page.getByTestId("fixed-tag-name-input").fill(name);
  await page.getByTestId("fixed-tag-tags-input").fill(tags);
  await page.getByTestId("fixed-tag-add").click();
  await page.getByTestId("fixed-tag-preset-select").selectOption({ label: name });
}

test("固定タグを選ぶと条件を満たすノートだけが残り、書き足したノートにはタグが付く", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 固定タグを持たない既存ノートを1件作る(モードOFFのまま)。
  await typeAndBlur(page, panes(page).first(), "既存メモ");
  await expect(page.getByText("既存メモ")).toBeVisible();
  await expect.poll(async () => panes(page).count()).toBe(4); // 非空1 + 末尾の空3

  await activatePreset(page, "仕事", "仕事 2026");
  await expect(page.getByTestId("fixed-tag-仕事")).toBeVisible();
  await expect(page.getByTestId("fixed-tag-2026")).toBeVisible();

  // 条件を満たさない既存ノートは盤面から消え、空プレースホルダ3件だけが残る
  // (空が残らないと、このモードで新しく書き始める場所が無くなる)。
  await expect.poll(async () => panes(page).count()).toBe(3);
  await expect(page.getByText("既存メモ")).toHaveCount(0);

  // 空ノートへ書いてフォーカスを外すと、本文末尾へ固定タグが入り、絞り込み後も残る。
  const target = panes(page).first();
  const targetId = (await target.getAttribute("data-testid"))!.replace("note-editor-area-", "");
  await typeAndBlur(page, target, "新しいメモ");

  const tags = page.getByTestId(`note-tags-${targetId}`);
  await expect(tags.getByText("#仕事")).toBeVisible();
  await expect(tags.getByText("#2026")).toBeVisible();
  await expect(page.getByTestId(`note-editor-area-${targetId}`)).toBeVisible();
  await expect(page.getByText("既存メモ")).toHaveCount(0); // 絞り込みは効いたまま

  // 本文の実体にタグが書かれている(表示だけでなく本文が正本 — entities/tags.ts)。
  const stored = await page.evaluate(async (id: string) => {
    // NO-LOG: 保存結果を読むだけのE2E内観察で、本番I/O経路ではない。
    const data = await chrome.storage.local.get("localData");
    const notes = (data.localData as { notes: { id: string; content: string }[] }).notes;
    return notes.find((n) => n.id === id)?.content ?? "";
  }, targetId);
  expect(stored).toBe("新しいメモ\n\n#仕事 #2026");

  // モードを戻すと隠れていたノートが戻る(消しているのではなく絞っているだけ)。
  await page.getByTestId("fixed-tag-preset-select").selectOption("");
  await expect(page.getByText("既存メモ")).toBeVisible();
});

test("空ノートには固定タグを付けない(触って離れただけでは何も起きない)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await activatePreset(page, "仕事", "仕事");
  await expect.poll(async () => panes(page).count()).toBe(3); // 空3件はそのまま残る

  // 何も打たずにフォーカスだけ出入りさせる。
  const target = panes(page).first();
  const targetId = (await target.getAttribute("data-testid"))!.replace("note-editor-area-", "");
  await target.locator(".cm-content").click();
  await target.locator(".note-pane-title-input").click();

  await expect(page.getByTestId(`note-tags-${targetId}`)).toHaveCount(0);
  await expect.poll(async () => panes(page).count()).toBe(3); // 空が汚れて増えたりしない
  const stored = await page.evaluate(async (id: string) => {
    // NO-LOG: 保存結果を読むだけのE2E内観察で、本番I/O経路ではない。
    const data = await chrome.storage.local.get("localData");
    const notes = (data.localData as { notes: { id: string; content: string }[] }).notes;
    return notes.find((n) => n.id === id)?.content ?? "(見つからない)";
  }, targetId);
  expect(stored).toBe("");
});

test("固定タグの行は文字サイズの行に収まり、隣の要素と重ならない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.getByTestId("fixed-tag-bar")).toBeVisible();

  // 目視でなく実測で確認する(CLAUDE.md: スクリーンショットの目視は検証にならない)。
  const rects = await page.evaluate(() => {
    const pick = (id: string) =>
      document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
    return {
      fontPlus: pick("note-font-increase"),
      bar: pick("fixed-tag-bar"),
      select: pick("fixed-tag-preset-select"),
      head: pick("note-sticky-head"),
    };
  });
  // 文字サイズのA＋ボタンより右にあり、重なっていない。
  expect(rects.bar.left).toBeGreaterThanOrEqual(rects.fontPlus.right);
  // 同じ行に載っている(縦位置が重なっている)。
  expect(rects.bar.top).toBeLessThan(rects.fontPlus.bottom);
  expect(rects.bar.bottom).toBeGreaterThan(rects.fontPlus.top);
  // セレクトはバーの内側に収まり、stickyヘッダからはみ出さない。
  expect(rects.select.left).toBeGreaterThanOrEqual(rects.bar.left - 1);
  expect(rects.select.right).toBeLessThanOrEqual(rects.bar.right + 1);
  expect(rects.bar.right).toBeLessThanOrEqual(rects.head.right + 1);
});

test("固定タグの選択はタブ毎に独立し、そのタブのリロードでは維持される", async ({
  context,
  newTabUrl,
}) => {
  const tab1 = await context.newPage();
  await tab1.goto(newTabUrl);
  await expect(tab1.getByTestId("app-root")).toBeVisible();

  // タグの違うノートを2件用意する(どちらのモードでも片方だけが残るように)。
  await typeAndBlur(tab1, panes(tab1).first(), "仕事のメモ #仕事");
  await typeAndBlur(tab1, panes(tab1).last(), "勉強のメモ #勉強");
  await expect(tab1.getByText("仕事のメモ")).toBeVisible();
  await expect(tab1.getByText("勉強のメモ")).toBeVisible();

  // プリセットは2つとも登録する(登録内容=全タブ共有の設定)。
  await tab1.getByTestId("fixed-tag-edit-toggle").click();
  for (const name of ["仕事", "勉強"]) {
    await tab1.getByTestId("fixed-tag-name-input").fill(name);
    await tab1.getByTestId("fixed-tag-tags-input").fill(name);
    await tab1.getByTestId("fixed-tag-add").click();
  }
  await tab1.getByTestId("fixed-tag-preset-select").selectOption({ label: "仕事" });
  await expect(tab1.getByText("勉強のメモ")).toHaveCount(0);
  await expect(tab1.getByText("仕事のメモ")).toBeVisible();

  // 別タブは「なし」で開く(選択が共有されていない証拠。登録プリセットは見えている)。
  const tab2 = await context.newPage();
  await tab2.goto(newTabUrl);
  await expect(tab2.getByTestId("app-root")).toBeVisible();
  await expect(tab2.getByTestId("fixed-tag-preset-select")).toHaveValue("");
  await expect(tab2.getByText("仕事のメモ")).toBeVisible();
  await expect(tab2.getByText("勉強のメモ")).toBeVisible();

  // 別タブで別のプリセットを選ぶ。
  await tab2.getByTestId("fixed-tag-preset-select").selectOption({ label: "勉強" });
  await expect(tab2.getByText("勉強のメモ")).toBeVisible();
  await expect(tab2.getByText("仕事のメモ")).toHaveCount(0);

  // 1枚目は「仕事」のまま——他タブの切替に引きずられない。
  await expect(tab1.getByText("仕事のメモ")).toBeVisible();
  await expect(tab1.getByText("勉強のメモ")).toHaveCount(0);

  // そのタブのリロードでは選択が残る(sessionStorage)。
  await tab2.reload();
  await expect(tab2.getByTestId("app-root")).toBeVisible();
  await expect(tab2.getByText("勉強のメモ")).toBeVisible();
  await expect(tab2.getByText("仕事のメモ")).toHaveCount(0);
});
