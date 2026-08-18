// data-panel-fileio.spec.ts — 「ファイルを開く」の回帰(2026-07-12)
// 元々showOpenFilePicker(File System Access API)を使っていたが、Chrome拡張機能の
// ページから呼ぶと選択後もAbortErrorで無反応になる既知のChromiumバグ
// (WICG/file-system-access#314、crbug.com/issues/40240444)があり、ボタンを押しても
// 何も起きないように見えていた。<input type="file">への置き換え後は通常のfile chooser
// イベントとして観測できる(src/lib/fileio/fileSystem.tsのヘッダー参照)。
// 「フォルダへ書き出し」ボタンは同じ既知バグが実機で解消できず(選択後にエラー
// メッセージすら出ない無反応のままだった)、ユーザー指示により撤去した。
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
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

test("端末ローカル設定(OpenRouter APIキー・保管庫パス等)もファイル経由で持ち運べる(2026-07-29)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  // 実UIから設定する(IndexedDBを直接書くとUIとの配線ごと壊れても気づけないため)。
  await page.getByTestId("data-set-openrouter-key").click();
  await page.getByTestId("data-openrouter-key-input").fill("sk-or-v1-テスト用キー");
  await page.getByTestId("data-save-openrouter-key").click();
  await expect(page.getByTestId("data-panel-message")).toContainText("OpenRouter");

  // 保管庫パスだけはUI経由で入れられない——保存前にnative host(nas_bridge.py)への到達確認が
  // 必須で、E2E環境にはhostが無いため必ず弾かれる。ここでは書き出し/取り込みの対象になることを
  // 見たいので、保存済みの状態だけをIndexedDBへ直接作る(UI配線はOpenRouterキー側が実UIで担保する)。
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("new-tab-board");
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("settings", "readwrite");
        tx.objectStore("settings").put("Z:\\保管庫\\テスト", "nasFolderPath");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("data-export-settings-file").click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  if (!downloadedPath) throw new Error("ダウンロードしたファイルのパスが取得できません");

  // 書き出したファイルに5項目が実際に入っていること(UIの成否ではなく中身で確かめる)。
  const exported = JSON.parse(readFileSync(downloadedPath, "utf-8")) as {
    deviceSettings?: Record<string, unknown>;
  };
  expect(exported.deviceSettings?.openrouterApiKey).toBe("sk-or-v1-テスト用キー");
  expect(exported.deviceSettings?.nasFolderPath).toBe("Z:\\保管庫\\テスト");

  // 書き出した後に別の値へ変えておき、取り込みで書き出し時点へ戻ることを確かめる
  // (IndexedDBを消して「新しい端末」を模すのは、DBを開いたままの削除がblockedになり
  //  不安定だったため採らない——上書きで戻ることが確認できれば復元の検証としては足りる)。
  // 保存すると入力欄は閉じるので開き直す。
  await page.getByTestId("data-set-openrouter-key").click();
  await page.getByTestId("data-openrouter-key-input").fill("sk-or-v1-上書きした別のキー");
  await page.getByTestId("data-save-openrouter-key").click();
  await expect.poll(async () => readStoredOpenRouterKey(page)).toBe("sk-or-v1-上書きした別のキー");

  const importChooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("data-import-settings-file").click();
  const importChooser = await importChooserPromise;
  await importChooser.setFiles(downloadedPath);
  await expect(page.getByTestId("data-panel-message")).toContainText("設定をファイルから読み込み");

  // 秘匿情報(APIキー)と保管庫パスの両方が、書き出した時点の値へ戻っている。
  await expect.poll(async () => readStoredOpenRouterKey(page)).toBe("sk-or-v1-テスト用キー");
  expect(await readStoredNasPath(page)).toBe("Z:\\保管庫\\テスト");

  // パネルを開いたまま取り込んでも「(設定済み)」表示が古いままにならない(2026-07-29)。
  await expect(page.getByTestId("data-set-openrouter-key")).toContainText("設定済み");
});

/** IndexedDBのsettingsストアから1件読む(取り込み結果をUIの表示ではなく実データで確かめる)。 */
function readSetting(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (k) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("new-tab-board");
        open.onsuccess = () => {
          const req = open.result
            .transaction("settings", "readonly")
            .objectStore("settings")
            .get(k);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
    key,
  );
}

function readStoredOpenRouterKey(page: Page): Promise<unknown> {
  return readSetting(page, "openrouterApiKey");
}

function readStoredNasPath(page: Page): Promise<unknown> {
  return readSetting(page, "nasFolderPath");
}

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
