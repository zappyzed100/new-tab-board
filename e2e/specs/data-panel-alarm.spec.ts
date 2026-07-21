// data-panel-alarm.spec.ts — この端末でアラーム(予定前・バッテリー)を鳴らすかのトグルUIの回帰
// (ユーザー指示: 複数PCで同じアラームが同時に鳴るのを避けたい。端末ローカル設定=db.tsなので
// settings backup/復元で他PCへ伝播しない。既定は鳴らす)。
import { expect, test } from "../fixtures";

test("既定は「この端末で鳴らす」で、押すと「鳴らさない」へ切り替わり永続する", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  const toggle = page.getByTestId("data-toggle-alarm");
  await expect(toggle).toContainText("この端末で鳴らす"); // 既定=鳴らす

  // レイアウト実測(UI変更は数値検証する — CLAUDE.md)。data-panelはwrapする横並びなので縦積みを
  // 仮定せず、①トグルが他ボタン(GAS連携)と矩形として重ならない ②パネルの枠内に収まっている
  // (はみ出し/被りの回帰を数値で固定)を確認する。
  const layout = await page.evaluate(() => {
    const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const panel = rect('[data-testid="data-panel"]');
    const battery = rect('[data-testid="data-set-battery-webhook"]');
    const toggle = rect('[data-testid="data-toggle-alarm"]');
    const overlap =
      toggle.left < battery.right &&
      battery.left < toggle.right &&
      toggle.top < battery.bottom &&
      battery.top < toggle.bottom;
    const withinPanel =
      toggle.left >= panel.left - 0.5 &&
      toggle.right <= panel.right + 0.5 &&
      toggle.top >= panel.top - 0.5 &&
      toggle.bottom <= panel.bottom + 0.5;
    return { overlap, withinPanel, w: toggle.width, h: toggle.height };
  });
  expect(layout.overlap).toBe(false); // 他ボタンと重ならない
  expect(layout.withinPanel).toBe(true); // パネルの枠内に収まる
  expect(layout.w).toBeGreaterThan(0); // 実体がある(表示されている)
  expect(layout.h).toBeGreaterThan(0);

  await toggle.click();
  await expect(toggle).toContainText("この端末では鳴らさない");
  await expect(page.getByTestId("data-panel-message")).toContainText("鳴らしません");

  // 別タブ(同一プロファイル=同じIndexedDB)を開いても「鳴らさない」が保たれる(端末ローカル永続)。
  const reopened = await context.newPage();
  await reopened.goto(newTabUrl);
  await expect(reopened.getByTestId("app-root")).toBeVisible();
  await reopened.getByTestId("toggle-data-panel").click();
  await expect(reopened.getByTestId("data-toggle-alarm")).toContainText("この端末では鳴らさない");
});
