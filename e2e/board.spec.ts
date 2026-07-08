// board.spec.ts — 新しいタブの最小スモークE2E(M0の一時的なプレースホルダ。M9で機能テストに置き換える)
import { expect, test } from "./fixtures";

test("新しいタブを開くとアプリのルートが表示される", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
});
