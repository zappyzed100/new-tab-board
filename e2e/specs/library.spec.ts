// library.spec.ts — 「📁 ライブラリ」(NASの階層md保管庫)のトグル開閉の回帰(2026-07-12)
// 作業ノートとは別レーンで、NASの library/ 配下の階層mdを一覧・開いて編集・保存する。
// このE2E環境にはnative-host(nas_bridge.py)もNASフォルダ設定も無いため、開くと
// listNasTreeは呼ぶ手前で「NASフォルダ未設定」の案内に落ちる——UIの配線(トグルで
// パネルが出入りし、案内が表示される)を実機貫通で確かめる。
import { expect, test } from "../fixtures";

test("「📁 ライブラリ」トグルでパネルが出入りする(NAS未設定なら案内が出る)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 既定では閉じている。
  await expect(page.getByTestId("library-panel")).toHaveCount(0);

  // 開くとパネルが現れ、NAS未設定の案内が出る(この環境ではNASフォルダ未設定)。
  await page.getByTestId("toggle-library").click();
  await expect(page.getByTestId("library-panel")).toBeVisible();
  await expect(page.getByTestId("library-message")).toContainText("NASフォルダが未設定");
  // 新規作成の入力欄と作成ボタンも見えている。
  await expect(page.getByTestId("library-new-path")).toBeVisible();
  await expect(page.getByTestId("library-create")).toBeVisible();

  // もう一度押すと閉じる。
  await page.getByTestId("toggle-library").click();
  await expect(page.getByTestId("library-panel")).toHaveCount(0);
});
