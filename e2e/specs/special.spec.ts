// special.spec.ts — ⭐スター/スペシャル(保管棚)の回帰。スターでスペシャル一覧に出る、削除で凍結して
// 残る、フォルダ作成、サイドバー配置(TODOの下・タグ候補の上)を数値/存在で検証(ユーザー指示)。
import { expect, test } from "../fixtures";

const panes = (page: import("@playwright/test").Page) =>
  page.locator('[data-testid^="note-editor-area-"]');

const idOf = async (pane: import("@playwright/test").Locator): Promise<string> => {
  const testid = await pane.getAttribute("data-testid");
  return testid!.replace("note-editor-area-", "");
};

test("スペシャルカードはTODOの下・タグ候補の上に置かれる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const todo = await page.getByTestId("todo-list").boundingBox();
  const special = await page.getByTestId("special-panel").boundingBox();
  const tags = await page.getByTestId("tag-candidates-panel").boundingBox();
  if (!todo || !special || !tags) throw new Error("sidebar panels not visible");
  // 縦順: TODO → スペシャル → タグ候補(上端の順で確認)。
  expect(todo.y).toBeLessThan(special.y);
  expect(special.y).toBeLessThan(tags.y);
});

test("スターでスペシャルに入り、削除すると凍結して一覧に残る", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const first = panes(page).first();
  const id = await idOf(first);
  // 本文を入れて非空にし、固有タイトルを付ける(末尾補充で消えないように)。
  await first.locator(".note-pane-title-input").fill("保管テスト");
  await first.locator(".cm-content").click();
  await page.keyboard.type("大事なメモ");

  // 初期はスペシャル空。
  await expect(page.getByTestId("special-empty")).toBeVisible();

  // ⭐スター → スペシャル一覧(live)に出る。
  await first.getByTestId(`star-note-${id}`).click();
  await expect(page.getByTestId(`special-entry-${id}`)).toBeVisible();
  await expect(page.getByTestId(`special-open-${id}`)).toHaveText("保管テスト");

  // ノートを削除 → スペシャルには「凍結」として残る(ノート一覧からは消える)。
  await first.getByTestId(`delete-note-${id}`).click();
  await expect(page.getByTestId(`note-editor-area-${id}`)).toHaveCount(0); // ボードから消えた
  await expect(page.getByTestId(`special-entry-${id}`)).toBeVisible(); // スペシャルには残る
  await expect(page.getByTestId(`special-frozen-${id}`)).toBeVisible(); // 凍結表示
});

test("スペシャルでフォルダを作成し、項目を移動できる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const first = panes(page).first();
  const id = await idOf(first);
  await first.locator(".cm-content").click();
  await page.keyboard.type("メモ");
  await first.getByTestId(`star-note-${id}`).click();

  // フォルダ作成。
  await page.getByTestId("special-new-folder").fill("仕事/2026");
  await page.getByTestId("special-create-folder").click();

  // 項目をそのフォルダへ移動(select)。
  await page.getByTestId(`special-folder-select-${id}`).selectOption("仕事/2026");
  await expect(page.getByTestId(`special-folder-select-${id}`)).toHaveValue("仕事/2026");
});
