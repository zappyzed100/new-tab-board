// watchdog.spec.ts — 「ブラウザが止まった」証拠が本当に残るかの回帰(ユーザー要望・2026-07-26)。
// 主スレッドを実際に塞いで、復帰後に stall として記録されること・その記録を画面から
// 取り出せることを確認する。止まっている最中は何も書けないので、**復帰直後に**残るのが要件。
import { expect, test } from "../fixtures";

/** 保存済みの診断ログ(chrome.storage.local の別キー。localDataとは分けてある)。 */
type DiagEvent = { kind: string; detail: string; metrics?: Record<string, number | boolean> };

test("主スレッドを塞ぐと、止まっていた時間が診断ログに残る", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const diagnostics = () =>
    page.evaluate(async () => {
      // NO-LOG: 保存結果を読むだけのE2E内観察で、本番I/O経路ではない。
      const stored = await chrome.storage.local.get("diagnosticsLog");
      return (stored.diagnosticsLog ?? []) as DiagEvent[];
    });

  // 開始時点で start が残っている(ウォッチドッグが動いている証拠)。
  await expect.poll(async () => (await diagnostics()).some((e) => e.kind === "start")).toBe(true);
  expect((await diagnostics()).some((e) => e.kind === "stall")).toBe(false);

  // 主スレッドを4秒塞ぐ。setTimeout/sleepではなく**本当に詰まらせる**のがこのテストの主旨
  // (止まっている最中は保存も走れない、という条件込みで検証したいため)。
  await page.evaluate(() => {
    const until = performance.now() + 4000;
    while (performance.now() < until) {
      /* 主スレッドを意図的に占有する */
    }
  });

  // 復帰後の最初の心拍で記録される。
  await expect
    .poll(async () => (await diagnostics()).filter((e) => e.kind === "stall").length)
    .toBeGreaterThan(0);
  const stall = (await diagnostics()).find((e) => e.kind === "stall")!;
  // 4秒塞いだので、心拍1回ぶん(1秒)を引いても2.5秒以上は遅れているはず。
  expect(Number(stall.metrics?.stallMs)).toBeGreaterThan(2500);
  // その時点の資源量も一緒に残る(次の調査の手がかり)。
  expect(Number(stall.metrics?.domNodes)).toBeGreaterThan(0);
  expect(stall.metrics).toHaveProperty("notes");
  // ノート本文は入れない(秘匿 — AGENTS.md §7)。値は数値と真偽値だけ。
  for (const value of Object.values(stall.metrics ?? {})) {
    expect(["number", "boolean"]).toContain(typeof value);
  }

  // 画面から取り出せる(データ管理 → 診断ログをコピー)。クリップボード権限の有無に関わらず
  // 要約はメッセージに出る。
  await page.getByTestId("toggle-data-panel").click();
  await page.getByTestId("data-copy-diagnostics").click();
  await expect(page.getByTestId("data-panel-message")).toContainText("停止1回");
});

test("「診断ログを消去」で保存済みの記録が空になる(拡張更新後に古い記録と混ざらないため)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const diagnostics = () =>
    page.evaluate(async () => {
      // NO-LOG: 保存結果を読むだけのE2E内観察で、本番I/O経路ではない。
      const stored = await chrome.storage.local.get("diagnosticsLog");
      return (stored.diagnosticsLog ?? []) as DiagEvent[];
    });

  // ウォッチドッグは起動時にstartを1件残すので、消去前は空でないことを確認してから消す。
  await expect.poll(async () => (await diagnostics()).length).toBeGreaterThan(0);

  await page.getByTestId("toggle-data-panel").click();
  await page.getByTestId("data-clear-diagnostics").click();
  await expect(page.getByTestId("data-panel-message")).toContainText("診断ログを消去しました");
  expect(await diagnostics()).toEqual([]);
});
