// data-panel-fileio.spec.ts — 「ファイルを開く」の回帰(2026-07-12)
// 元々showOpenFilePicker(File System Access API)を使っていたが、Chrome拡張機能の
// ページから呼ぶと選択後もAbortErrorで無反応になる既知のChromiumバグ
// (WICG/file-system-access#314、crbug.com/issues/40240444)があり、ボタンを押しても
// 何も起きないように見えていた。<input type="file">への置き換え後は通常のfile chooser
// イベントとして観測できる(src/lib/fileio/fileSystem.tsのヘッダー参照)。
// 「フォルダへ書き出し」ボタンは同じ既知バグが実機で解消できず(選択後にエラー
// メッセージすら出ない無反応のままだった)、ユーザー指示により撤去した。
import { expect, test } from "../fixtures";

test("ファイルを開くで.txtの中身が新規ノートとして取り込まれる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const beforeCount = await page.locator(".note-tab").count();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("data-open-file").click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "会議メモ.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("開いた内容のテスト"),
  });

  await expect(page.locator(".note-tab")).toHaveCount(beforeCount + 1);
  await expect(page.getByTestId("data-panel-message")).toContainText("会議メモ");
  await expect(
    page.locator('[data-testid^="note-editor-area-"][data-active="true"] .cm-content'),
  ).toHaveText("開いた内容のテスト");
});

test("データ管理パネルの結果メッセージが出ても、ショートカット一覧ボタンの位置は動かない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const shortcutsButton = page.getByTestId("open-shortcuts-modal");
  const before = await shortcutsButton.boundingBox();
  if (!before) throw new Error("open-shortcuts-modal is not visible");

  await page.getByTestId("data-flush-nas").click();
  await expect(page.getByTestId("data-panel-message")).toBeVisible();

  const after = await shortcutsButton.boundingBox();
  if (!after) throw new Error("open-shortcuts-modal is not visible");
  expect(after).toEqual(before);

  // メッセージはDOM上でもショートカットボタンより後ろ(ユーザー指摘: メッセージが
  // ショートカットボタンより前にあると、幅いっぱいのメッセージがボタンを押し下げる)。
  const messageIsAfterButton = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="open-shortcuts-modal"]');
    const msg = document.querySelector('[data-testid="data-panel-message"]');
    if (!btn || !msg) return false;
    return !!(btn.compareDocumentPosition(msg) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(messageIsAfterButton).toBe(true);
});
