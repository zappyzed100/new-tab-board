// shortcuts-theme-calendar.spec.ts — ショートカット一覧/テーマ切替/小型カレンダーのE2E(SPEC.md §4.6・§4.8・§4.9)
import { expect, test } from "../fixtures";

test("ショートカット一覧モーダルが開閉できる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await page.getByTestId("open-shortcuts-modal").click();
  await expect(page.getByTestId("shortcuts-modal")).toBeVisible();
  await expect(page.getByTestId("shortcuts-modal")).toContainText("全文検索欄にフォーカス");
  await page.getByTestId("shortcuts-modal-close").click();
  await expect(page.getByTestId("shortcuts-modal")).not.toBeVisible();
});

test("ショートカット一覧モーダルは外側クリックでも閉じる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await page.getByTestId("open-shortcuts-modal").click();
  await expect(page.getByTestId("shortcuts-modal")).toBeVisible();
  // Radix Dialogはoverlay(背景)をコンポーネント内部にカプセル化しており外部から
  // data-testidを付与できないため、Radix標準のoverlayクラスをセレクタに使う。
  await page.locator(".rt-DialogOverlay").click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId("shortcuts-modal")).not.toBeVisible();
});

test("テーマ切替がdocument.documentElementへ反映される", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // Radix Selectは独自のポップオーバー実装(ネイティブ<select>ではない)なので
  // selectOption()は使えず、トリガーをクリック→該当optionをクリックする形にする。
  await page.getByTestId("theme-select").click();
  await page.getByRole("option", { name: "ダーク" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByTestId("theme-select").click();
  await page.getByRole("option", { name: "ライト" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("小型カレンダーは常時表示され、前月/翌月に移動できる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // トグル不要(常時表示のサイドバーウィジェット)
  await expect(page.getByTestId("mini-calendar")).toBeVisible();
  const initialLabel = await page.getByTestId("calendar-month-label").textContent();

  await page.getByTestId("calendar-next-month").click();
  await expect(page.getByTestId("calendar-month-label")).not.toHaveText(initialLabel ?? "");

  await page.getByTestId("calendar-prev-month").click();
  await expect(page.getByTestId("calendar-month-label")).toHaveText(initialLabel ?? "");
});

test("小型カレンダーの前月/翌月ボタンと月ラベルが重ならず、日付グリッドと横幅が揃う", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const prevBox = await page.getByTestId("calendar-prev-month").boundingBox();
  const labelBox = await page.getByTestId("calendar-month-label").boundingBox();
  const nextBox = await page.getByTestId("calendar-next-month").boundingBox();
  const gridBox = await page.locator(".rdp-month_grid").boundingBox();
  if (!prevBox || !labelBox || !nextBox || !gridBox) {
    throw new Error("カレンダーの各要素が計測できなかった");
  }

  // react-day-picker既定のNavはposition:absoluteで右端固定されるため、単純な
  // componentsオーバーライドだけだと月ラベルと重なる/離れすぎる崩れが起きていた
  // (実際に起きた回帰)。前月ボタン→ラベル→翌月ボタンの順で重ならず並ぶことを確認する。
  expect(prevBox.x + prevBox.width).toBeLessThanOrEqual(labelBox.x + 1);
  expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(nextBox.x + 1);

  // ヘッダー行(前月ボタン〜翌月ボタン)の横幅と日付グリッドの横幅が大きくズレて
  // いない(自前ヘッダーは全幅、グリッドは固定幅のままで食い違っていた回帰)ことを確認する。
  const headerWidth = nextBox.x + nextBox.width - prevBox.x;
  expect(Math.abs(headerWidth - gridBox.width)).toBeLessThan(20);
});

test("データ操作パネルは既定で折りたたまれ、トグルで開閉できる(2026-07-18)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 新規タブを開いた直後はノート内容を一目で見せたいため、既定で畳んである
  // (ユーザー指示。以前は逆に「トグル不要・常時表示」だったが要望により再び折りたたみ式へ)。
  // display:noneではなくアンマウントで隠すため、要素そのものが存在しない。
  await expect(page.getByTestId("data-panel")).toHaveCount(0);

  await page.getByTestId("toggle-data-panel").click();
  await expect(page.getByTestId("data-panel")).toBeVisible();

  await page.getByTestId("toggle-data-panel").click();
  await expect(page.getByTestId("data-panel")).toHaveCount(0);
});

test("データ操作パネルはブックマークバーの上に展開する(2026-07-18・ユーザー指示)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  const order = await page.evaluate(() => {
    const dataPanel = document.querySelector('[data-testid="data-panel"]');
    const bookmarkGrid = document.querySelector('[data-testid="bookmark-grid"]');
    if (!dataPanel || !bookmarkGrid) return null;
    return !!(dataPanel.compareDocumentPosition(bookmarkGrid) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(order).toBe(true); // data-panelがbookmark-gridより前(DOM順・視覚順とも上)
});

test("データ操作/ショートカット一覧のトグルは常駐の上下スクロールボタンと重ならない(2026-07-18)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 930, height: 868 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const shortcutsRect = await page.getByTestId("open-shortcuts-modal").boundingBox();
  const scrollTopRect = await page.getByTestId("scroll-to-top").boundingBox();
  if (!shortcutsRect || !scrollTopRect) throw new Error("layout elements not visible");

  // 横方向に重なっていない(右端の常駐スクロールボタンとヘッダー右側のボタン列との衝突回帰)。
  const overlapX =
    Math.min(shortcutsRect.x + shortcutsRect.width, scrollTopRect.x + scrollTopRect.width) -
    Math.max(shortcutsRect.x, scrollTopRect.x);
  expect(overlapX).toBeLessThanOrEqual(0);
});

test("全文検索/NAS検索も既定で折りたたまれ、トグルで開閉できる(2026-07-18)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // データ操作パネルと同じ理由(ノート内容を一目で見せたい)で、これらも既定で畳んである。
  await expect(page.getByTestId("search-panel")).toHaveCount(0);
  await expect(page.getByTestId("tag-search-panel")).toHaveCount(0);

  await page.getByTestId("toggle-search-panel").click();
  await expect(page.getByTestId("search-panel")).toBeVisible();
  // 開いた瞬間に検索欄へフォーカスが当たる(Cmd/Ctrl+Fと同じ体験をクリックでも保証)。
  await expect(page.getByTestId("search-input")).toBeFocused();

  await page.getByTestId("toggle-tag-search-panel").click();
  await expect(page.getByTestId("tag-search-panel")).toBeVisible();

  await page.getByTestId("toggle-search-panel").click();
  await expect(page.getByTestId("search-panel")).toHaveCount(0);
  await page.getByTestId("toggle-tag-search-panel").click();
  await expect(page.getByTestId("tag-search-panel")).toHaveCount(0);
});
