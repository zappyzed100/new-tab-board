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
  await page.getByTestId("toggle-data-panel").click();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("data-open-file").click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "会議メモ.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("開いた内容のテスト"),
  });

  // 取り込んだノート(タイトル=会議メモ)がボードに現れる(タブは撤去済みなので、
  // どこかのノート名見出しに「会議メモ」が存在することで確認する)。
  await expect
    .poll(async () =>
      page
        .locator(".note-pane-title-input")
        .evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value)),
    )
    .toContain("会議メモ");
  await expect(page.getByTestId("data-panel-message")).toContainText("会議メモ");
  await expect(
    page.locator('[data-testid^="note-editor-area-"][data-active="true"] .cm-content'),
  ).toHaveText("開いた内容のテスト");
});

test("ファイルを開くをキャンセルしても、無反応ではなくキャンセルの案内が出る", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("data-open-file").click();
  const fileChooser = await fileChooserPromise;
  // ファイルを選ばずに閉じた状態を模す(input.filesが空のままchangeが発火するのは
  // 実際のキャンセル操作とpickAndReadTextFile側からは区別が付かない挙動)。
  await fileChooser.setFiles([]);

  await expect(page.getByTestId("data-panel-message")).toContainText(
    "ファイル選択がキャンセルされました",
  );
});

test("設定をファイルへ書き出し、読み込み直すと設定が復元される(2026-07-29)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  // 既定と区別できる値へ変えてから書き出す(復元されたことを値で確かめるため)。
  await page.getByTestId("note-font-increase").click();
  const exportedFontSize = await page.evaluate(async () => {
    const stored = await chrome.storage.local.get("syncData");
    return (stored.syncData as { settings: { noteFontSize?: number } }).settings.noteFontSize;
  });
  expect(exportedFontSize).toBeDefined();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("data-export-settings-file").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^new-tab-board-settings-\d{4}-\d{2}-\d{2}\.json$/);
  const downloadedPath = await download.path();
  if (!downloadedPath) throw new Error("ダウンロードしたファイルのパスが取得できません");
  await expect(page.getByTestId("data-panel-message")).toContainText("設定をファイルへ書き出し");

  // 書き出した後に設定を変えておき、読み込みで書き出し時点へ戻ることを確かめる。
  await page.getByTestId("note-font-decrease").click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const stored = await chrome.storage.local.get("syncData");
        return (stored.syncData as { settings: { noteFontSize?: number } }).settings.noteFontSize;
      }),
    )
    .not.toBe(exportedFontSize);

  const importChooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("data-import-settings-file").click();
  const importChooser = await importChooserPromise;
  await importChooser.setFiles(downloadedPath);

  await expect(page.getByTestId("data-panel-message")).toContainText("設定をファイルから読み込み");
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const stored = await chrome.storage.local.get("syncData");
        return (stored.syncData as { settings: { noteFontSize?: number } }).settings.noteFontSize;
      }),
    )
    .toBe(exportedFontSize);
});

test("設定の読み込みで設定ファイルでないJSONを選ぶと、無反応ではなくエラーが出る(2026-07-29)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("data-import-settings-file").click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "無関係.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"まったく別の形":true}'),
  });

  await expect(page.getByTestId("data-panel-message")).toContainText(
    "設定ファイルとして読めません",
  );
});

test("データ管理パネルの結果メッセージが出ても、ショートカット一覧ボタンの位置は動かない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

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
