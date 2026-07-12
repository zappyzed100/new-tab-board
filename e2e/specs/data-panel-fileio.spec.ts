// data-panel-fileio.spec.ts — 「ファイルを開く」「フォルダへ書き出し」の回帰(2026-07-12)
// 元々どちらもFile System Access API(showOpenFilePicker/showDirectoryPicker)を使って
// いたが、Chrome拡張機能のページから呼ぶと選択後もAbortErrorで無反応になる既知の
// Chromiumバグ(WICG/file-system-access#314、crbug.com/issues/40240444)があり、
// ボタンを押しても何も起きないように見えていた。<input type="file">・chrome.downloads
// への置き換え後は通常のfile chooser/downloadイベントとして観測できる
// (src/lib/fileio/fileSystem.tsのヘッダー参照)。
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

test("フォルダへ書き出しでノート件数ぶんのダウンロードが発生する", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await page.getByTestId("note-tab-add").click();
  const noteCount = await page.locator(".note-tab").count();

  const suggestedNames: string[] = [];
  page.on("download", (download) => suggestedNames.push(download.suggestedFilename()));

  await page.getByTestId("data-export-folder").click();
  await expect.poll(() => suggestedNames.length).toBe(noteCount);
  expect(suggestedNames.every((name) => name.endsWith(".md"))).toBe(true);
});
