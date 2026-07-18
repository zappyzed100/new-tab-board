// tag-search.spec.ts — タグ/本文/期間でNAS検索するパネルのUI回帰(2026-07-13)
// 実際のNAS検索は native-host が要るためE2E不可。ここではUI操作(自由入力タグ・カスタム期間・
// NAS未設定時の案内)を検証する。検索SQL自体は pytest、貼り付けは pasteResultsIntoNotes 単体で担保。
import { expect, test } from "../fixtures";

test("タグ検索パネル: 自由入力タグ・カスタム期間・NAS未設定時の案内", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-tag-search-panel").click();
  await expect(page.getByTestId("tag-search-panel")).toBeVisible();

  // 自由入力タグ → 選択タグのチップが出る。
  await page.getByTestId("tag-input").fill("コーディング");
  await page.getByTestId("tag-input").press("Enter");
  await expect(page.getByTestId("selected-tag-コーディング")).toBeVisible();
  await expect(page.getByTestId("tag-input")).toHaveValue(""); // 追加後に入力欄は空へ

  // 期間プリセット「カスタム」→ from/to の日付入力が現れる。
  await page.getByTestId("range-preset-custom").click();
  await expect(page.getByTestId("range-from")).toBeVisible();
  await expect(page.getByTestId("range-to")).toBeVisible();

  // 検索(NAS未設定)→ 未設定の案内が出る(外部通信は起きない)。
  await page.getByTestId("search-notes-btn").click();
  await expect(page.getByTestId("tag-search-message")).toContainText("NASフォルダが未設定");
});
