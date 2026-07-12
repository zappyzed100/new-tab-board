// notes-race.spec.ts — 「ノート追加ボタンを連打すると作ったノートが消える」バグの回帰(§13昇格対象)
// 原因: 複数の呼び出しがそれぞれ古いclosure内のnotes(propsスナップショット)から新しい
// 配列を計算し、setNotesへ値そのものを渡していた(後勝ちで上書きされ消えていた)。
// Playwrightの通常の.click()は毎回アクショナビリティ待機が入り自然に間隔が空いてしまうため、
// 同一タスク内で複数回clickを発火させてReactの自動バッチ更新を強制し、タイミングに依存せず
// 決定的にこの競合を再現する。
import { expect, test } from "../fixtures";

test("ノート追加ボタンを連打しても、できたノートが消えずに全て残る", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await page.evaluate(() => {
    const btn = document.querySelector<HTMLElement>('[data-testid="note-tab-add"]');
    btn?.click();
    btn?.click();
    btn?.click();
    btn?.click();
  });

  await expect(page.locator(".note-tab")).toHaveCount(4);
});
