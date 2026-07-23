// note-editing-protection.spec.ts — 編集中ノートを外部同期の巻き戻し/削除から構造的に守る回帰
// ユーザー報告: あるノートを編集中に別経路の同期(別タブ/NAS/Drive/backgroundの確定revision)が
// 届くと、編集中ノートの本文が古い断面で上書きされ入力が消える。対策は「activeNoteId 1件」だけの
// 保護ではなく、フォーカス中/未保存のノート全部を不可侵にする編集シーム(ドラフトバッファ＋
// 編集レジストリ)。ここでは購読経路(chrome.storage.onChanged)へ外部writerIdの stale localData を
// 流し込み、編集中ノートが①本文を巻き戻されない②ボードから消されない、を実測する。
import { expect, test } from "../fixtures";
import type { Page } from "@playwright/test";

// 各ノートペインの id を linear order 順に読む(data-testid="note-editor-area-<id>")。
async function paneIds(page: Page): Promise<string[]> {
  const pairs = await page.locator(".note-cell[data-linear-index]").evaluateAll((cells) =>
    cells.map((c) => ({
      idx: Number(c.getAttribute("data-linear-index")),
      id:
        (c.querySelector('[data-testid^="note-editor-area-"]') as HTMLElement | null)
          ?.getAttribute("data-testid")
          ?.replace("note-editor-area-", "") ?? "",
    })),
  );
  return pairs.sort((a, b) => a.idx - b.idx).map((p) => p.id);
}

// 外部タブ/バックグラウンドの確定revisionを模擬する。現在のlocalDataを土台に、指定ノートの本文を
// 差し替え(または削除し)、別の storageWriterId と十分に大きい storageRevision を付けて書き込む。
// これで storage.ts の購読(subscribeLocalData)が「他コンテキストの確定通知」として App へ配布する。
// CSP(script-src 'self')が new Function を禁じるため、関数は渡さずプレーンなデータで指示する。
type ExternalWrite = {
  /** このノートの本文を古い値へ巻き戻す(削除ではない)。 */
  revertContentId?: string;
  revertContent?: string;
  /** このノートを断面から欠落させる(=古いタブがこのノートを知らずに全体保存した状況)。 */
  dropId?: string;
  /** 同期が適用された証拠に使う別ノートのタイトルを書き換える。 */
  markerId: string;
  markerTitle: string;
};

async function injectExternalWrite(page: Page, spec: ExternalWrite): Promise<void> {
  await page.evaluate(async (s) => {
    // NO-LOG: 隔離E2Eプロファイルで購読経路を駆動する観察用注入。本番I/Oではない。
    const stored = await chrome.storage.local.get("localData");
    const current = (stored.localData ?? {}) as {
      notes?: Record<string, unknown>[];
      storageRevision?: number;
    };
    const notes = (current.notes ?? [])
      .filter((n) => n.id !== s.dropId)
      .map((n) => {
        if (n.id === s.revertContentId) return { ...n, content: s.revertContent };
        if (n.id === s.markerId) return { ...n, title: s.markerTitle };
        return n;
      });
    const next = {
      ...current,
      notes,
      storageWriterId: "external-tab-e2e",
      storageRevision: (current.storageRevision ?? 0) + 50,
    };
    await chrome.storage.local.set({ localData: next });
  }, spec);
}

test("編集中ノートは外部stale同期で本文を巻き戻されない", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const ids = await paneIds(page);
  expect(ids.length).toBeGreaterThanOrEqual(2);
  const editingId = ids[0]; // 編集する対象(本文ペインをクリック——selectNoteは呼ばれず「非選択」のまま)
  const markerId = ids[1]; // 同期が適用された証拠に使う別ノート

  // 対象ノートの本文へ入力する(タイトルではなく本文ペイン=CM6)。
  const USER_TEXT = "USER-EDITING-KEEP-THIS";
  const editorArea = page.getByTestId(`note-editor-area-${editingId}`);
  await editorArea.locator(".cm-content").click();
  await page.keyboard.type(USER_TEXT);
  await expect(editorArea.locator(".cm-content")).toContainText(USER_TEXT);

  // 外部タブの stale 確定revisionを注入する: 編集中ノートは古い本文へ、別ノートには適用検知用の
  // マーカーtitleを付ける。編集中ノートの本文はローカルの入力を上書きしてはならない。
  await injectExternalWrite(page, {
    revertContentId: editingId,
    revertContent: "STALE-OVERWRITE-FROM-EXTERNAL",
    markerId,
    markerTitle: "EXTERNAL-SYNC-APPLIED",
  });

  // 同期が適用された確定点: マーカーノートのタイトルが反映されるまで待つ(=購読tickが処理済み)。
  await expect(page.getByTestId(`note-title-${markerId}`)).toHaveValue("EXTERNAL-SYNC-APPLIED");

  // 本命の不変条件: 編集中ノートの本文は入力のまま。外部の古い本文で巻き戻っていない。
  await expect(editorArea.locator(".cm-content")).toContainText(USER_TEXT);
  await expect(editorArea.locator(".cm-content")).not.toContainText(
    "STALE-OVERWRITE-FROM-EXTERNAL",
  );
});

test("編集中ノートは外部stale同期(欠落)でボードから消えない", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const ids = await paneIds(page);
  expect(ids.length).toBeGreaterThanOrEqual(2);
  const editingId = ids[0];
  const markerId = ids[1];

  const USER_TEXT = "USER-EDITING-DO-NOT-DELETE";
  const editorArea = page.getByTestId(`note-editor-area-${editingId}`);
  await editorArea.locator(".cm-content").click();
  await page.keyboard.type(USER_TEXT);
  await expect(editorArea.locator(".cm-content")).toContainText(USER_TEXT);

  // 外部の古い断面が編集中ノートを含まない(=そのノートを知らない古いタブが全体保存した)状況。
  await injectExternalWrite(page, {
    dropId: editingId,
    markerId,
    markerTitle: "EXTERNAL-SYNC-APPLIED",
  });

  await expect(page.getByTestId(`note-title-${markerId}`)).toHaveValue("EXTERNAL-SYNC-APPLIED");

  // 編集中ノートは消えず、本文も保持されている。
  await expect(page.getByTestId(`note-editor-area-${editingId}`)).toBeVisible();
  await expect(editorArea.locator(".cm-content")).toContainText(USER_TEXT);
});
