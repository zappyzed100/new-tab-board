// note-manual-tags.spec.ts — 本文の `#タグ`(手動タグ)がタグとして認識されることの回帰
// (ユーザー指示・2026-07-23)。手動タグの正本は本文なので、実際に打鍵する経路で固定する。
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

/** 先頭の空ノートペインへ本文を打ち込み、そのノートidを返す。 */
async function typeIntoFirstNote(page: Page, text: string): Promise<string> {
  const pane = page.locator('[data-testid^="note-editor-area-"]').first();
  const paneTestId = await pane.getAttribute("data-testid");
  if (!paneTestId) throw new Error("ノートペインのtestidを取得できません");
  await pane.locator(".cm-content").click();
  await page.keyboard.type(text);
  return paneTestId.replace("note-editor-area-", "");
}

test("本文の #タグ がタグとして表示され、Geminiの自動タグ枠とは別物として残る", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const noteId = await typeIntoFirstNote(page, "固有値の復習 #数学 #線形代数");

  const tags = page.getByTestId(`note-tags-${noteId}`);
  await expect(tags).toBeVisible();
  await expect(tags.getByText("#数学")).toBeVisible();
  await expect(tags.getByText("#線形代数")).toBeVisible();
  // 手動タグは本文由来であることが区別できる(Geminiの自動タグは data-tag-origin="ai")
  await expect(tags.locator('[data-tag-origin="manual"]')).toHaveCount(2);
  await expect(tags.locator('[data-tag-origin="ai"]')).toHaveCount(0);

  // 本文からタグを消すと表示からも消える(本文が正本であることの確認)
  await page.locator(`[data-testid="note-editor-area-${noteId}"] .cm-content`).click();
  await page.keyboard.press("End");
  for (let i = 0; i < "#線形代数".length; i += 1) await page.keyboard.press("Backspace");
  await expect(tags.getByText("#線形代数")).toHaveCount(0);
  await expect(tags.getByText("#数学")).toBeVisible();
});

test("Markdownの見出しやコードブロック内の # はタグにしない", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // CodeMirrorの自動インデント等に左右されないよう、行は個別に入力する
  const noteId = await typeIntoFirstNote(page, "# 見出しはタグではない");
  await page.keyboard.press("Enter");
  await page.keyboard.type("本文 #本物タグ");

  const tags = page.getByTestId(`note-tags-${noteId}`);
  await expect(tags.getByText("#本物タグ")).toBeVisible();
  await expect(tags.getByText("#見出しはタグではない")).toHaveCount(0);
  await expect(tags.locator("[data-tag-origin]")).toHaveCount(1);
});
