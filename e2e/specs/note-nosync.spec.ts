// note-nosync.spec.ts — 「この端末のみ・同期しない」トグルの回帰(ユーザー指示: パスワード等を貼る用)
// トグルONのノートは NAS/Drive/Gemini/バックアップへ本文を出さない(除外の実体は各lib/Appの
// egressチョークポイントで、そちらは単体テストで検証)。ここではUIの契約を実測する:
// ①トグルで note.noSync が chrome.storage.local へ立つ ②AIボタン(要約/TODO/タグ)が無効化される
// ③「暗号化ではない」と明示するバッジが出る ④もう一度押すと解除される。
import { expect, test } from "../fixtures";
import type { Page } from "@playwright/test";

async function firstNoteId(page: Page): Promise<string> {
  const testId = await page
    .locator('[data-testid^="note-editor-area-"]')
    .first()
    .getAttribute("data-testid");
  return (testId ?? "").replace("note-editor-area-", "");
}

async function storedNoSync(page: Page, id: string): Promise<boolean | undefined> {
  return page.evaluate(async (noteId) => {
    // NO-LOG: 隔離E2Eプロファイルで保存済みフラグを読むだけの観察。本番I/Oではない。
    const stored = await chrome.storage.local.get("localData");
    const notes = (stored.localData as { notes?: { id: string; noSync?: boolean }[] } | undefined)
      ?.notes;
    return notes?.find((n) => n.id === noteId)?.noSync;
  }, id);
}

test("同期しないトグル: noSyncフラグ・AIボタン無効化・注意バッジ・解除", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const id = await firstNoteId(page);
  const editorArea = page.getByTestId(`note-editor-area-${id}`);
  await editorArea.locator(".cm-content").click();
  await page.keyboard.type("パスワード: hunter2");

  const toggle = page.getByTestId(`nosync-note-${id}`);
  const summarize = page.getByTestId(`summarize-${id}`);
  const extractTodos = page.getByTestId(`extract-todos-${id}`);
  const tag = page.getByTestId(`tag-note-${id}`);

  // 初期状態: 同期する(noSync未設定)・AIボタンは有効・バッジ無し。
  expect(await storedNoSync(page, id)).toBeFalsy();
  await expect(summarize).toBeEnabled();
  await expect(page.getByTestId(`nosync-badge-${id}`)).toHaveCount(0);

  // トグルON。
  await toggle.click();

  // ① storage に noSync=true が立つ。
  await expect.poll(() => storedNoSync(page, id)).toBe(true);
  // ② AIボタン(要約/TODO抽出/タグ)が無効化される(本文を Gemini へ送らないため)。
  await expect(summarize).toBeDisabled();
  await expect(extractTodos).toBeDisabled();
  await expect(tag).toBeDisabled();
  // ③ 「暗号化ではない」と明示するバッジが出る。
  await expect(page.getByTestId(`nosync-badge-${id}`)).toBeVisible();
  await expect(page.getByTestId(`nosync-badge-${id}`)).toContainText("暗号化ではありません");

  // ④ もう一度押すと解除され、AIボタンが戻る。
  await toggle.click();
  await expect.poll(() => storedNoSync(page, id)).toBeFalsy();
  await expect(summarize).toBeEnabled();
  await expect(page.getByTestId(`nosync-badge-${id}`)).toHaveCount(0);
});
