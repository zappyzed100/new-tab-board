// board.spec.ts — 新しいタブボードのE2E(拡張機能を実際にロードして検証。GUARDRAILS.md §12.4)
import { expect, test } from "./fixtures";

test("新しいタブを開くとボードが表示され、カードを追加・削除できる", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);

  await expect(page.getByTestId("board")).toBeVisible();

  const todoColumn = page.locator("section", { has: page.getByRole("heading", { name: "Todo" }) });
  await expect(todoColumn).toBeVisible();

  await todoColumn.getByLabel("新しいカード").fill("E2Eから追加したカード");
  await todoColumn.getByRole("button", { name: "カードを追加" }).click();

  const cardItem = todoColumn.locator("li", { hasText: "E2Eから追加したカード" });
  await expect(cardItem).toBeVisible();

  await cardItem.getByRole("button", { name: "削除" }).click();
  await expect(cardItem).toHaveCount(0);
});
