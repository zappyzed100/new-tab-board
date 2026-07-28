// note-wrap.spec.ts — 本文の折り返し(幅固定)トグルの回帰(ユーザー指示・2026-07-25)。
// 「折り返し」ボタンでCM6のlineWrappingをCompartmentで付け外しする。目視ではなく
// scrollWidth/clientWidth の実測で「横へはみ出しているか」を判定する(CLAUDE.md)。
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const SCROLLER = '[data-testid="notepad-editor"] .cm-scroller';
const LONG_LINE = "折り返し確認のためのとても長い一行です ".repeat(8);

/** 先頭ノートのCM6の実測値。overflow>0 = 横スクロールが必要(=折り返していない)。
 * 伸びはスクローラでなく**行の高さ**で見る——エディタには min-height:320px があり、
 * 短めの本文では折り返しても外枠の高さが変わらないため(それで測ると常に偽陰性になる)。 */
async function metrics(page: Page) {
  return page
    .locator(SCROLLER)
    .first()
    .evaluate((el) => ({
      overflow: el.scrollWidth - el.clientWidth,
      lineHeight: el.querySelector(".cm-line")!.getBoundingClientRect().height,
    }));
}

test("「折り返し」ボタンで本文の折り返しを切り替えられ、本文は変わらない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const pane = page.locator('[data-testid^="note-editor-area-"]').first();
  await pane.locator(".cm-content").click();
  await page.keyboard.type(LONG_LINE);

  // 既定は折り返さない(CM6既定)——長い行は横へはみ出す。
  await expect(page.getByTestId("note-wrap-toggle")).toHaveAttribute("aria-pressed", "false");
  const before = await metrics(page);
  expect(before.overflow).toBeGreaterThan(0);

  await page.getByTestId("note-wrap-toggle").click();
  await expect(page.getByTestId("note-wrap-toggle")).toHaveAttribute("aria-pressed", "true");

  // 折り返しON: 横へはみ出さなくなり、その1行が複数行ぶんの高さになる。
  await expect.poll(async () => (await metrics(page)).overflow).toBeLessThanOrEqual(0);
  expect((await metrics(page)).lineHeight).toBeGreaterThan(before.lineHeight * 2);

  // 表示設定の切替なので本文は1文字も変わらない(再構成であって再マウント/書き換えではない)。
  await expect(pane.locator(".cm-content")).toHaveText(LONG_LINE);

  // 戻せる(トグル)。
  await page.getByTestId("note-wrap-toggle").click();
  await expect(page.getByTestId("note-wrap-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await metrics(page)).overflow).toBeGreaterThan(0);
});

test("折り返し設定は保存され、開き直したタブにも効く", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await page.locator('[data-testid^="note-editor-area-"]').first().locator(".cm-content").click();
  await page.keyboard.type(LONG_LINE);
  await page.getByTestId("note-wrap-toggle").click();
  await expect(page.getByTestId("note-wrap-toggle")).toHaveAttribute("aria-pressed", "true");

  const reopened = await context.newPage();
  await reopened.goto(newTabUrl);
  await expect(reopened.getByTestId("app-root")).toBeVisible();
  await expect(reopened.getByTestId("note-wrap-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await metrics(reopened)).overflow).toBeLessThanOrEqual(0);
});

test("「折り返し」ボタンは文字サイズ・固定タグと同じ行に並び、重ならない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const rects = await page.evaluate(() => {
    const pick = (id: string) =>
      document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
    return {
      fontPlus: pick("note-font-increase"),
      wrap: pick("note-wrap-toggle"),
      bar: pick("fixed-tag-bar"),
    };
  });
  // A＋ → 折り返し → 固定タグ の順に、重ならずに並ぶ。
  expect(rects.wrap.left).toBeGreaterThanOrEqual(rects.fontPlus.right);
  expect(rects.bar.left).toBeGreaterThanOrEqual(rects.wrap.right);
  // 同じ行(縦位置が重なっている)。
  expect(rects.wrap.top).toBeLessThan(rects.fontPlus.bottom);
  expect(rects.wrap.bottom).toBeGreaterThan(rects.fontPlus.top);
});
