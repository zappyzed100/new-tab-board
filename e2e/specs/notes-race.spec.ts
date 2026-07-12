// notes-race.spec.ts — NoteTabs周りの状態競合バグの回帰まとめ(§13昇格対象)
// 1件目: 「ノート追加ボタンを連打すると作ったノートが消える」バグ。原因は複数の呼び出しが
// それぞれ古いclosure内のnotes(propsスナップショット)から新しい配列を計算し、setNotesへ
// 値そのものを渡していたこと(後勝ちで上書きされ消えていた)。Playwrightの通常の.click()は
// 毎回アクショナビリティ待機が入り自然に間隔が空いてしまうため、同一タスク内で複数回click
// を発火させてReactの自動バッチ更新を強制し、タイミングに依存せず決定的に再現する。
// 2件目: 表示選択チェックボックスがタブ選択のmousedownと競合して即座にキャンセルされる
// バグ。こちらは生radix-uiのmousedownタイミング依存の実際のブラウザイベント順序が
// 本質のため、合成clickではなくPlaywrightの実クリックで再現する。
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

test("表示選択チェックボックスへのクリックが、タブ選択のmousedownと競合して即キャンセルされない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 4件のノートを実クリックで追加する(追加のたびにタブが自動選択され、表示中3件が
  // 決まった状態になる。5件目以降は無くても4件で「表示する3件」チェックボックスが出る)。
  for (let i = 0; i < 4; i++) {
    await page.getByTestId("note-tab-add").click();
  }

  const checkboxes = page.locator('[data-testid^="note-tab-visible-"]');
  await expect(checkboxes).toHaveCount(4);

  // 表示中(checked)から1件を外し、非表示(unchecked)側に空きを1つ作る。
  await page.locator('[data-testid^="note-tab-visible-"][data-state="checked"]').first().click();

  // 空いた枠へ、これまで非表示だった別の1件を実クリックでチェックする。
  // 生radix-uiのTabsTriggerはclickではなくmousedownの時点でcontext.onValueChangeを
  // 呼ぶ実装のため、対策前はチェックボックスのクリックがタブ選択(mousedown)を誘発し、
  // App.tsxのselectNote()がrequestedVisibleIdsを別ロジック(スワップ式)で書き換えてから
  // 直後のonCheckedChangeが「もう含まれている」と判定して外してしまい、チェックした
  // 直後に自動的にキャンセルされていた。
  // クリック後は状態がchecked側に変わる想定のため、data-state条件で都度絞り込む
  // ライブロケータではなく、対象のtestidを先に確定させてから固定ロケータで検証する
  // (でないと「unchecked」条件が自己無効化し、クリックした本人ではなく別の要素を
  // 拾ってしまい偽陰性/偽陽性になる)。
  const targetTestId = await page
    .locator('[data-testid^="note-tab-visible-"][data-state="unchecked"]')
    .first()
    .getAttribute("data-testid");
  const target = page.locator(`[data-testid="${targetTestId}"]`);
  await target.click();

  await expect(target).toHaveAttribute("data-state", "checked");
});
