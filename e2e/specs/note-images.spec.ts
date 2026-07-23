// note-images.spec.ts — ノート添付画像(NASのみ保存・揮発キャッシュ)の回帰(ユーザー指示・2026-07-23)
//
// E2EではNASブリッジ(native messaging host)が導入されていない=常に「NAS未登録/未接続」の状態。
// ユーザー要件のうち **その状態でどう振る舞うか** を固定する:
// - 本文の `![](nas:…)` はプレビューで画像として描画しない(壊れた画像アイコンを出さない)
// - 画像を貼り付けても本文へ参照を書かない(表示できない参照だけが残る事故を作らない)
// - 画像実体をブラウザ内へ貯める旧経路(貼り付け画像パネル/IndexedDBストア)が消えている
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

/** 先頭の空ノートペインへ本文を打ち込み、そのノートidを返す。 */
async function typeIntoFirstNote(page: Page, text: string): Promise<string> {
  const pane = page.locator('[data-testid^="note-editor-area-"]').first();
  const paneTestId = await pane.getAttribute("data-testid");
  if (!paneTestId) throw new Error("ノートペインのtestidを取得できません");
  await pane.locator(".cm-content").click();
  await page.keyboard.type(text);
  return paneTestId.replace("note-editor-area-", "");
}

/** 確定状態(chrome.storage.local)へ本文が入りきるまで待ってからプレビューへ切り替える。 */
async function openPreview(page: Page, noteId: string, expectedContent: string): Promise<void> {
  await page.waitForFunction(
    async ([id, expected]) => {
      const data = await chrome.storage.local.get("localData");
      const local = data.localData as { notes?: { id: string; content: string }[] } | undefined;
      const note = local?.notes?.find((n) => n.id === id);
      return typeof note?.content === "string" && note.content.includes(expected);
    },
    [noteId, expectedContent] as const,
  );
  await page.getByTestId(`toggle-preview-${noteId}`).click();
  await expect(page.getByTestId("markdown-preview").first()).toBeVisible();
}

test("NASが未登録なら nas: 参照の画像はノートに表示しない(altだけ残る)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const reference = "![板書](nas:images/n1/a.png)";
  const noteId = await typeIntoFirstNote(page, reference);
  await openPreview(page, noteId, "nas:images/n1/a.png");

  const preview = page.getByTestId("markdown-preview").first();
  await expect(preview).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(0);
  // altテキストは残す(そこに画像があること自体は分かる)
  await expect(preview).toContainText("板書");
});

test("画像を貼り付けてもNAS未登録なら本文へ参照を書かない(表示できない参照を残さない)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const noteId = await typeIntoFirstNote(page, "板書メモ");
  const editor = page.locator(`[data-testid="note-editor-area-${noteId}"] .cm-content`);
  await editor.click();

  // 1x1 PNG を DataTransfer に載せて貼り付ける(実クリップボードは使わない)
  await editor.evaluate((el) => {
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    const file = new File([bytes], "shot.png", { type: "image/png" });
    const data = new DataTransfer();
    data.items.add(file);
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });

  // NAS未登録なので保存できず、その旨がメッセージ欄へ出る
  await expect(page.getByText("画像を保存できませんでした", { exact: false })).toBeVisible();
  // 本文には参照が書かれていない(貼り付け前の本文のまま)
  await expect(editor).not.toContainText("nas:");
  const stored = await page.evaluate(async (id) => {
    const data = await chrome.storage.local.get("localData");
    const local = data.localData as { notes?: { id: string; content: string }[] } | undefined;
    return local?.notes?.find((n) => n.id === id)?.content ?? "";
  }, noteId);
  expect(stored).not.toContain("nas:");
});

test("画像をブラウザ内へ貯める旧経路が消えている(パネルとIndexedDBストア)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await expect(page.getByTestId("pasted-images-panel")).toHaveCount(0);
  const stores = await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open("new-tab-board");
        req.onsuccess = () => {
          const names = [...req.result.objectStoreNames];
          req.result.close();
          resolve(names);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  expect(stores).not.toContain("pastedImages");
  expect(stores).toContain("snapshots"); // DBそのものは生きている(消し過ぎていない)
});

test("NAS未登録なら添付画像の帯は描画されず、ノート下部のレイアウトも崩れない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const noteId = await typeIntoFirstNote(page, "板書メモ #数学");
  await expect(page.getByTestId(`note-tags-${noteId}`)).toBeVisible();

  // 帯そのものが出ない(空の箱を置いて余白だけ空ける、をしていない)
  await expect(page.getByTestId(`note-images-${noteId}`)).toHaveCount(0);

  // エディタとタグ行が重ならず、両者の間に不自然な隙間(帯の高さ相当)も空いていないことを実測する
  const gap = await page.evaluate((id) => {
    const pane = document.querySelector(`[data-testid="note-editor-area-${id}"]`);
    const editor = pane?.querySelector(".cm-editor");
    const tags = document.querySelector(`[data-testid="note-tags-${id}"]`);
    if (!editor || !tags) throw new Error("エディタ/タグ行を取得できません");
    const e = editor.getBoundingClientRect();
    const t = tags.getBoundingClientRect();
    return { editorBottom: Math.round(e.bottom), tagsTop: Math.round(t.top) };
  }, noteId);
  expect(gap.tagsTop).toBeGreaterThanOrEqual(gap.editorBottom); // 重なっていない
  expect(gap.tagsTop - gap.editorBottom).toBeLessThan(64); // 帯(96px超)の分は空いていない
});
