// history-growth.spec.ts — 履歴スナップショットが「無編集で増えない」ことの回帰(2026-07-25)。
//
// ユーザー報告「放置していたら重くなる/ブラウザが止まる」の調査で見つけた実害:
// useSnapshotScheduler の lastContentRef が null 始まりだったため、
// exceedsChangeThreshold(null, content) が 200文字以上のノートで常に true になり、
// **編集していなくてもペインがマウントしただけで1件保存**されていた。ペインは窓化
// (ViewportNote)によりスクロールのたび・タブを開くたびにマウントするので、無編集のまま
// 際限なく増える。実測(300ノート): 初回ロード18件・上下スクロール1往復ごとに+20件・
// タブを3回開閉するだけで+48件。1件ごとに gzip + IndexedDB put + indexSnapshot(全トークンの
// refs 配列を読んで書き戻す)が走り、refs は溜まった件数に比例して伸びるため**溜まるほど
// 1件が重くなる**——時間とともに重くなる症状の増分がこれ。
//
// 「しばらく使ってみて重くならなかった」を合否にしない(e2e/stress/CLAUDE.md)。
// スクロールとタブ開閉を圧縮して回し、件数が1件も増えないことを数える。
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const NOTE_COUNT = 300;
// 200文字(CHANGE_THRESHOLD_CHARS)を超える本文——旧実装がマウントだけで刻んでいた条件。
const SEEDED_CONTENT = "履歴の無編集増殖を検出するための本文です。".repeat(14);

/** IndexedDBに溜まっているスナップショット件数(履歴の実体)。 */
async function snapshotCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open("new-tab-board");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("snapshots", "readonly");
          const count = tx.objectStore("snapshots").count();
          tx.oncomplete = () => {
            db.close();
            resolve(count.result);
          };
        };
      }),
  );
}

test("スクロールとタブ開閉を繰り返しても履歴は1件も増えない(編集すれば増える)", async ({
  context,
  newTabUrl,
}) => {
  const worker = context.serviceWorkers()[0];
  const notes = Array.from({ length: NOTE_COUNT }, (_, i) => ({
    id: `history-note-${i}`,
    title: `履歴ノート${i}`,
    content: SEEDED_CONTENT,
    pinned: false,
    order: i,
    createdAt: i,
    updatedAt: i,
  }));
  // resource-budget.spec.ts と同じ理由でfixtureのblankページを再利用する
  // (context.newPage()はnew-tab overrideを起動し、空stateの保存がseedを上書きしうる)。
  const page = context.pages()[0];
  if (!page) throw new Error("E2E fixtureのblankページが見つかりません");
  await worker.evaluate(
    async ({ seededNotes }) => {
      // NO-LOG: 隔離E2Eプロファイルへ決定的なfixtureを投入するだけで、本番I/Oではない。
      await chrome.storage.local.set({
        localData: { notes: seededNotes, todos: [] },
        syncData: {
          bookmarks: [],
          appLaunches: [],
          settings: {
            openIn: "same",
            theme: "light",
            searchEngine: "https://www.google.com/search?q=%s",
          },
        },
      });
    },
    { seededNotes: notes },
  );

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  const editors = page.locator(".cm-editor");
  await expect.poll(() => editors.count()).toBeGreaterThan(0);
  // ロードしただけ(=多数のペインがマウントしただけ)では1件も刻まれない。
  expect(await snapshotCount(page)).toBe(0);

  // 上下往復でペインのマウント/アンマウントを集中させる。旧実装はここで+20件/往復だった。
  const mountedIds = () =>
    page.locator('.note-cell[data-viewport-state="mounted"]').evaluateAll((cells) =>
      cells
        .map((c) => c.getAttribute("data-note-id"))
        .sort()
        .join(","),
    );
  for (let round = 0; round < 3; round++) {
    const before = await mountedIds();
    await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
    });
    // 「別のノート群がマウントされた」を待つ(固定時間待ちにしない)。
    await expect.poll(mountedIds).not.toBe(before);
    expect(await snapshotCount(page)).toBe(0);

    const atBottom = await mountedIds();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }));
    await expect.poll(mountedIds).not.toBe(atBottom);
    expect(await snapshotCount(page)).toBe(0);
  }

  // タブを開いて閉じるだけ(=新しいタブを開く実際の使い方)。旧実装は1回あたり+16件だった。
  for (let i = 0; i < 3; i++) {
    const churn = await context.newPage();
    await churn.goto(newTabUrl);
    await expect(churn.getByTestId("app-root")).toBeVisible();
    await expect.poll(() => churn.locator(".cm-editor").count()).toBeGreaterThan(0);
    expect(await snapshotCount(churn)).toBe(0);
    await churn.close();
  }
  expect(await snapshotCount(page)).toBe(0);

  // 履歴機能そのものは生きている: 実際に閾値を超えて編集すれば刻まれる。
  const pane = page.locator('[data-testid^="note-editor-area-"]').first();
  await pane.locator(".cm-content").click();
  await page.keyboard.insertText("追記".repeat(120)); // 240文字 > CHANGE_THRESHOLD_CHARS
  await expect.poll(() => snapshotCount(page)).toBeGreaterThan(0);
});
