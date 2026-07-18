// data-panel-nas.spec.ts — 「NASフォルダを設定」のパス入力方式の回帰(2026-07-12)
// 以前はshowDirectoryPicker()を使っていたが、Chrome拡張機能のページから呼ぶと
// 選択後もAbortErrorになる既知のChromiumバグ(WICG/file-system-access#314、
// crbug.com/issues/40240444)が実機で解消できず(エラーメッセージすら出ない無反応の
// ままだった)、ユーザー指示によりNative Messaging(native-host/nas_bridge.py)経由の
// パス入力方式へ置き換えた。ネイティブダイアログに依存しなくなったためE2Eで検証できる
// (契約: docs/nas-native-messaging-protocol.md)。
//
// パス入力欄は常時表示だと見苦しいため(ユーザー指摘)、「NASフォルダを設定」ボタンを
// 押した時だけその右に出る(ブックマーク/ノートの編集フォームと同じ「押したらその場に
// 出る」パターン)。
import { expect, test } from "../fixtures";

test("「NASフォルダを設定」を押すまで入力欄は表示されない", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  await expect(page.getByTestId("data-nas-path-input")).toHaveCount(0);

  await page.getByTestId("data-set-nas-folder").click();

  await expect(page.getByTestId("data-nas-path-input")).toBeVisible();
  await expect(page.getByTestId("data-save-nas-path")).toBeVisible();
});

test("NASフォルダのパスが空欄なら保存を試みず案内する", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  await page.getByTestId("data-set-nas-folder").click();
  await page.getByTestId("data-save-nas-path").click();

  await expect(page.getByTestId("data-panel-message")).toContainText(
    "NASフォルダのパスを入力してください",
  );
});

test("NASブリッジ未導入のパスを保存しようとすると、到達できない旨を案内する", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  await page.getByTestId("data-set-nas-folder").click();
  await page.getByTestId("data-nas-path-input").fill("Z:\\NAS\\backup");
  await page.getByTestId("data-save-nas-path").click();

  // このテスト環境にはnative-host/nas_bridge.pyが導入されていないため、
  // probeNasPath()のchrome.runtime.connectNativeが必ず失敗する。
  await expect(page.getByTestId("data-panel-message")).toContainText(
    "NASフォルダに到達できませんでした",
  );
});

test("「NASから復元」はNAS未設定なら復元を試みず案内する(notes/テーマ/TODO/ブックマーク/スペシャル等の設定バックアップ)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  // NASフォルダ未設定の状態(このテストはNASパスを保存しない)。
  await page.getByTestId("data-restore-from-nas").click();

  await expect(page.getByTestId("data-panel-message")).toContainText(
    "NASに設定バックアップがまだありません",
  );
});
