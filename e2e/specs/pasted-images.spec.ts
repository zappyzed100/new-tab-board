// pasted-images.spec.ts — Ctrl+Vで貼り付けた画像の一次保存/一覧/削除のE2E(2026-07-13)
// 実際のクリップボード書き込み(コピー)は権限が要るためここでは検証しない(ボタンの存在まで)。
// 画像の貼り付けは、canvasで作ったPNGを clipboardData に載せた paste イベントを直接dispatchして再現する。
import { expect, test } from "../fixtures";

test("画像を貼り付けると一覧に出て、削除できる(ノートの下の画像パネル)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 画像パネルはノート類の下にあり、最初は空。
  await expect(page.getByTestId("pasted-images-panel")).toBeVisible();
  await expect(page.getByTestId("pasted-images-empty")).toBeVisible();

  // PNGを作って paste イベントとして貼り付ける。
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#f00";
    ctx.fillRect(0, 0, 4, 4);
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "pasted.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }));
  });

  // サムネイルが1件現れる(コピー/削除ボタン付き)。
  const items = page.locator(
    '[data-testid^="pasted-image-"]:not([data-testid*="copy"]):not([data-testid*="delete"])',
  );
  await expect(items).toHaveCount(1);
  await expect(page.locator('[data-testid^="pasted-image-copy-"]')).toHaveCount(1);
  await expect(page.locator(".pasted-image-thumb")).toBeVisible();

  // 再読み込みしても残る(IndexedDBに保存されている)。
  await page.reload();
  await expect(page.locator(".pasted-image-thumb")).toBeVisible();

  // 削除すると消える。
  await page.locator('[data-testid^="pasted-image-delete-"]').first().click();
  await expect(page.locator(".pasted-image-thumb")).toHaveCount(0);
  await expect(page.getByTestId("pasted-images-empty")).toBeVisible();
});
