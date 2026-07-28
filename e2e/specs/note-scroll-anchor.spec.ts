// note-scroll-anchor.spec.ts — 再配置しても「読んでいる位置」が動かないことの回帰(2026-07-27)。
//
// ユーザー報告「長いノートをいくつか抱えて、読もうと下に下げていくと配置が変わって読みづらい」。
// 実測masonryは高さが確定/変化するたび全ノートのtopを置き直し、その確定契機がスクロールそのもの
// (窓化でペイン/CM6がマウントし、仮の520px・320pxが実測へ置き換わる)なので、下へ読み進めるほど
// 盤面が動く。セルは絶対配置+inline styleなのでブラウザのスクロールアンカリングも効かない。
//
// 目視ではなく、アンカーノートの getBoundingClientRect().top が保たれることを数値で検査する。
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const NOTE_COUNT = 24;

/** 長短が大きく入り混じったノート群(高さの確定で大きく動く条件を作る)。
 * **長いノートは1行を長くする**——折り返しの有無で高さが数倍変わるのはこの形だけで、
 * 短い行を並べただけの本文では折り返しを切り替えても高さが1pxも変わらない(最初にこれで
 * テストを書き、修正を外しても緑になってしまった)。
 * 先頭3件を短くして、各列の1件目がアンカーにならない(=上に必ず別のノートがある)ようにする。 */
function seededNotes() {
  const longLine = "折り返しで高さが大きく変わる長い一行の本文です。".repeat(10);
  return Array.from({ length: NOTE_COUNT }, (_, i) => ({
    id: `anchor-note-${i}`,
    title: `アンカーノート${i}`,
    content:
      i >= 3 && i % 2 === 1
        ? Array.from({ length: 12 }, (__, line) => `${line}: ${longLine}`).join("\n")
        : `ノート${i} 短い本文`,
    pinned: false,
    order: i,
    createdAt: i,
    updatedAt: i,
  }));
}

/** 画面内で一番大きく見えているノートの id と、その画面上の位置。 */
async function visibleAnchor(page: Page): Promise<{ noteId: string; top: number }> {
  return page.evaluate(() => {
    const cells = document.querySelectorAll<HTMLElement>(
      '.note-cell[data-viewport-state="mounted"][data-note-id]',
    );
    let best = { noteId: "", top: 0 };
    let bestOverlap = -1;
    for (const cell of cells) {
      const rect = cell.getBoundingClientRect();
      const overlap = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = { noteId: cell.dataset.noteId ?? "", top: rect.top };
      }
    }
    return best;
  });
}

async function noteTop(page: Page, noteId: string): Promise<number> {
  return page.evaluate(
    (id) =>
      document
        .querySelector<HTMLElement>(`.note-cell[data-note-id="${id}"]`)!
        .getBoundingClientRect().top,
    noteId,
  );
}

test("盤面が再配置されても、読んでいるノートの画面上の位置は動かない", async ({
  context,
  newTabUrl,
}) => {
  const worker = context.serviceWorkers()[0];
  const page = context.pages()[0];
  if (!page) throw new Error("E2E fixtureのblankページが見つかりません");
  await worker.evaluate(
    async ({ notes }) => {
      // NO-LOG: 隔離E2Eプロファイルへ決定的なfixtureを投入するだけで、本番I/Oではない。
      await chrome.storage.local.set({
        localData: { notes, todos: [] },
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
    { notes: seededNotes() },
  );

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect.poll(() => page.locator(".cm-editor").count()).toBeGreaterThan(0);

  // 途中まで読み進めた状態を作る。
  await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "auto" }));
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(1000);

  const anchor = await visibleAnchor(page);
  expect(anchor.noteId).not.toBe("");

  // 全ノートの高さが一斉に変わる操作(=最大級の再配置)を起こす。原因が何であれ読んでいる位置は
  // 動かない、という性質を確かめたいので、スクロール以外の確実な契機で検査する。
  await page.getByTestId("note-wrap-toggle").click();
  await expect(page.getByTestId("note-wrap-toggle")).toHaveAttribute("aria-pressed", "true");

  // 再配置が落ち着くまで待ってから、アンカーの画面位置を測り直す。
  await expect
    .poll(async () => Math.abs((await noteTop(page, anchor.noteId)) - anchor.top) < 4, {
      timeout: 10_000,
    })
    .toBe(true);

  // 文字サイズの変更でも同じ(高さが全件変わる別経路)。
  const beforeFont = await visibleAnchor(page);
  await page.getByTestId("note-font-increase").click();
  await expect
    .poll(async () => Math.abs((await noteTop(page, beforeFont.noteId)) - beforeFont.top) < 4, {
      timeout: 10_000,
    })
    .toBe(true);
});

test("最上部にいるときは補正しない(勝手に下がらない)", async ({ context, newTabUrl }) => {
  const worker = context.serviceWorkers()[0];
  const page = context.pages()[0];
  if (!page) throw new Error("E2E fixtureのblankページが見つかりません");
  await worker.evaluate(
    async ({ notes }) => {
      // NO-LOG: 隔離E2Eプロファイルへ決定的なfixtureを投入するだけで、本番I/Oではない。
      await chrome.storage.local.set({
        localData: { notes, todos: [] },
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
    { notes: seededNotes() },
  );

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect.poll(() => page.locator(".cm-editor").count()).toBeGreaterThan(0);

  await page.getByTestId("note-wrap-toggle").click();
  await expect(page.getByTestId("note-wrap-toggle")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(0);
});
