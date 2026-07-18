// resource-budget.spec.ts — 500ノート時の詳細ペイン・描画・timer・Observer・DOM上限を検査する。
import { expect, test } from "../fixtures";

const STRESS_NOTE_COUNT = 500;
const PANE_BUDGET = 32;
const EDITOR_BUDGET = 24;
const OBSERVER_BUDGET = 40;
const TIMER_BUDGET = 140;
const DOM_NODE_BUDGET = 8_000;

test("500ノートを往復してもブラウザ資源は表示領域ぶんに制限される", async ({
  context,
  newTabUrl,
}) => {
  const worker = context.serviceWorkers()[0];
  const notes = Array.from({ length: STRESS_NOTE_COUNT }, (_, i) => ({
    id: `stress-note-${i}`,
    title: `負荷ノート${i}`,
    content: Array.from({ length: 24 }, (__, line) => `ノート${i} 行${line}`).join("\n"),
    pinned: false,
    order: i,
    createdAt: i,
    updatedAt: i,
  }));
  // fixtureが初期Appの保存完了後にblank化した既存ページを再利用する。context.newPage()は
  // new-tab overrideを一瞬起動し、blank化後も3件stateの非同期保存が継続してseedを上書きする。
  const page = context.pages()[0];
  if (!page) throw new Error("E2E fixtureのblankページが見つかりません");
  await page.addInitScript(() => {
    const budget = {
      intervals: new Set<number>(),
      timeouts: new Set<number>(),
      resizeObservers: 0,
      intersectionObservers: 0,
    };
    const nativeSetInterval = window.setInterval;
    const nativeClearInterval = window.clearInterval;
    const nativeSetTimeout = window.setTimeout;
    const nativeClearTimeout = window.clearTimeout;
    window.setInterval = ((...args: Parameters<typeof nativeSetInterval>) => {
      const id = nativeSetInterval(...args);
      budget.intervals.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      if (typeof id === "number") budget.intervals.delete(id);
      nativeClearInterval(id);
    }) as typeof window.clearInterval;
    window.setTimeout = ((...args: Parameters<typeof nativeSetTimeout>) => {
      const id = nativeSetTimeout(...args);
      budget.timeouts.add(id);
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (typeof id === "number") budget.timeouts.delete(id);
      nativeClearTimeout(id);
    }) as typeof window.clearTimeout;

    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeResizeObserver {
      private budgetActive = true;
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        budget.resizeObservers += 1;
      }
      disconnect() {
        if (this.budgetActive) {
          budget.resizeObservers -= 1;
          this.budgetActive = false;
        }
        super.disconnect();
      }
    };
    const NativeIntersectionObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeIntersectionObserver {
      private budgetActive = true;
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super(callback, options);
        budget.intersectionObservers += 1;
      }
      disconnect() {
        if (this.budgetActive) {
          budget.intersectionObservers -= 1;
          this.budgetActive = false;
        }
        super.disconnect();
      }
    };
    Object.defineProperty(window, "__newTabBoardResourceBudget", {
      value: () => ({
        timers: budget.intervals.size + budget.timeouts.size,
        resizeObservers: budget.resizeObservers,
        intersectionObservers: budget.intersectionObservers,
      }),
    });
  });
  // 計測スクリプト登録を終えてからfixtureを投入し、そのまま明示URLへ遷移する。
  await worker.evaluate(
    async ({ seededNotes }) => {
      // NO-LOG: 隔離E2Eプロファイルへ決定的な負荷fixtureを投入するだけで、本番I/Oではない。
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
  expect(
    await worker.evaluate(async () => {
      // NO-LOG: 隔離E2Eプロファイルへ投入した負荷fixtureの件数確認で、本番I/Oではない。
      const stored = await chrome.storage.local.get("localData");
      return (stored.localData as { notes?: unknown[] } | undefined)?.notes?.length ?? 0;
    }),
  ).toBe(STRESS_NOTE_COUNT);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.locator(".note-cell")).toHaveCount(STRESS_NOTE_COUNT + 3);

  const mountedPanes = page.locator('.note-cell[data-viewport-state="mounted"]');
  const deferredPanes = page.locator('.note-cell[data-viewport-state="deferred"]');
  const mountedEditors = page.locator(".cm-editor");
  await expect.poll(() => mountedEditors.count()).toBeGreaterThan(0);
  expect(await mountedPanes.count()).toBeLessThanOrEqual(PANE_BUDGET);
  expect(await deferredPanes.count()).toBeGreaterThan(STRESS_NOTE_COUNT * 0.8);
  expect(await mountedEditors.count()).toBeLessThanOrEqual(EDITOR_BUDGET);

  const resourceCounts = () =>
    page.evaluate(() => {
      const getBudget = (
        window as unknown as Window & {
          __newTabBoardResourceBudget: () => {
            timers: number;
            resizeObservers: number;
            intersectionObservers: number;
          };
        }
      ).__newTabBoardResourceBudget;
      return {
        ...getBudget(),
        domNodes: document.getElementsByTagName("*").length,
      };
    });
  const expectWithinBudget = async () => {
    const counts = await resourceCounts();
    expect(counts.timers).toBeLessThanOrEqual(TIMER_BUDGET);
    expect(counts.resizeObservers).toBeLessThanOrEqual(OBSERVER_BUDGET);
    expect(counts.intersectionObservers).toBeLessThanOrEqual(OBSERVER_BUDGET);
    expect(counts.domNodes).toBeLessThanOrEqual(DOM_NODE_BUDGET);
  };
  await expectWithinBudget();

  // 上端↔下端を繰り返して詳細ペインとEditorViewの生成/破棄を短時間に集中させる。
  // 親版は全503件を常駐するため、最初のPANE_BUDGET検査で必ず赤になる。
  for (let i = 0; i < 6; i++) {
    const goBottom = i % 2 === 0;
    await page.evaluate((bottom) => {
      window.scrollTo({
        top: bottom ? document.documentElement.scrollHeight : 0,
        behavior: "auto",
      });
    }, goBottom);
    await expect.poll(() => mountedPanes.count()).toBeLessThanOrEqual(PANE_BUDGET);
    expect(await deferredPanes.count()).toBeGreaterThan(STRESS_NOTE_COUNT * 0.8);
    expect(await mountedEditors.count()).toBeLessThanOrEqual(EDITOR_BUDGET);
    await expectWithinBudget();
  }

  // 新しいタブの生成/破棄も同じGPUプロセスを使う。短時間に繰り返し、ページが応答不能に
  // ならずapp-rootまで到達できることを検査する。
  for (let i = 0; i < 8; i++) {
    const churnPage = await context.newPage();
    await churnPage.goto(newTabUrl);
    await expect(churnPage.getByTestId("app-root")).toBeVisible();
    await churnPage.close();
  }
});
