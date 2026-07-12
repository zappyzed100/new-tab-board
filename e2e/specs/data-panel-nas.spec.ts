// data-panel-nas.spec.ts — 「NASフォルダを設定」のパス入力方式の回帰(2026-07-12)
// 以前はshowDirectoryPicker()を使っていたが、Chrome拡張機能のページから呼ぶと
// 選択後もAbortErrorになる既知のChromiumバグ(WICG/file-system-access#314、
// crbug.com/issues/40240444)が実機で解消できず(エラーメッセージすら出ない無反応の
// ままだった)、ユーザー指示によりNative Messaging(native-host/nas_bridge.py)経由の
// パス入力方式へ置き換えた。ネイティブダイアログに依存しなくなったためE2Eで検証できる
// (契約: docs/nas-native-messaging-protocol.md)。
import { expect, test } from "../fixtures";

test("NASフォルダのパスが空欄なら保存を試みず案内する", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await page.getByTestId("data-set-nas-folder").click();

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

  await page.getByTestId("data-nas-path-input").fill("Z:\\NAS\\backup");
  await page.getByTestId("data-set-nas-folder").click();

  // このテスト環境にはnative-host/nas_bridge.pyが導入されていないため、
  // probeNasPath()のchrome.runtime.connectNativeが必ず失敗する。
  await expect(page.getByTestId("data-panel-message")).toContainText(
    "NASフォルダに到達できませんでした",
  );
});
