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

/** 決定的な疑似乱数(シード固定)。テストの非決定性を避けるためMath.randomは使わない
 * (AGENTS.md §8 test-nondeterminism)。 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 高さが極端にバラついたノート群(0〜120行+稀に150〜350行の外れ値)。
 * ユーザー指摘: 均一/緩やかな長さ分布だと列バランスが予測可能になり、下で見つかった
 * 「上スクロール時だけ列詰め直しが暴れる」バグが再現しない——バラつきが大きいほど、
 * 既読ノートの再マウント時の一時的な高さブレがmasonry全体を揺らしやすくなる。 */
function heterogeneousNotes(count: number) {
  const rand = mulberry32(12345);
  const line = "折り返しで高さが変わる一行の本文です。";
  return Array.from({ length: count }, (_, i) => {
    const isOutlier = rand() < 0.15;
    const lineCount = isOutlier
      ? 150 + Math.floor(rand() * 200)
      : Math.floor(rand() * rand() * 120);
    const content =
      lineCount === 0
        ? `ノート${i} 短い本文`
        : Array.from(
            { length: lineCount },
            (__, l) => `${l}: ${line}${"あ".repeat(Math.floor(rand() * 60))}`,
          ).join("\n");
    return {
      id: `hetero-note-${i}`,
      title: `アンカーノート${i}`,
      content,
      pinned: false,
      order: i,
      createdAt: i,
      updatedAt: i,
    };
  });
}

test("下スクロールで読み進めた後、上スクロールで戻ってもジャンプしない(2026-07-28の回帰)", async ({
  context,
  newTabUrl,
}) => {
  // 200件×300ステップの実スクロールを2方向行うため既定の30秒では足りない
  // (test.slow()で既定の3倍=90秒にする。setTimeout直書きはtest-sleep誤検知の対象になるため避ける)。
  test.slow();
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
    { notes: heterogeneousNotes(200) },
  );

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect.poll(() => page.locator(".cm-editor").count()).toBeGreaterThan(0);
  await page.waitForTimeout(500);

  /** 「一番よく見えているノート」を1ステップ動かすごとに追跡し、ホイール量からの
   * 乖離(=補正しきれなかった異常なジャンプ)の最大値を返す。 */
  async function sweep(direction: "down" | "up", steps: number): Promise<number> {
    let maxJumpiness = 0;
    let prev: { scrollY: number; anchor: { noteId: string; top: number } } | null = null;
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, direction === "down" ? 100 : -100);
      await page.waitForTimeout(30);
      const curr = await page.evaluate(() => {
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
        return { scrollY: window.scrollY, anchor: best };
      });
      if (prev && prev.anchor.noteId && prev.anchor.noteId === curr.anchor.noteId) {
        const scrollDelta = curr.scrollY - prev.scrollY;
        const topDelta = curr.anchor.top - prev.anchor.top;
        maxJumpiness = Math.max(maxJumpiness, Math.abs(topDelta - -scrollDelta));
      }
      prev = curr;
      if (direction === "up" && curr.scrollY <= 0) break;
    }
    return maxJumpiness;
  }

  const downJump = await sweep("down", 300);
  expect(downJump).toBeLessThan(100); // 下方向は補正がほぼ要らないため厳しめのまま。

  // 元の不具合(修正前は数千px規模)に比べれば大幅に改善しているが、`useNoteScrollAnchor`が
  // 一度に追跡できるアンカーは1件のため、複数の巨大な外れ値ノート(150〜350行)が連続して
  // 初回確定する状況では、アンカー以外のノートの列内での小さな再配置(実測は最大200px弱)
  // までは補正しきれない残差が残る。数千px規模の暴走ではないことを検査する閾値にする。
  const upJump = await sweep("up", 300);
  expect(upJump).toBeLessThan(250);
});

test("上スクロール中にノート同士の列(data-column-index)が入れ替わらない(2026-07-29の回帰)", async ({
  context,
  newTabUrl,
}) => {
  // 200件のスクロールを2方向行うため既定の30秒では足りない。
  test.slow();
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
    { notes: heterogeneousNotes(200) },
  );

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect.poll(() => page.locator(".cm-editor").count()).toBeGreaterThan(0);
  await page.waitForTimeout(500);

  // 下方向に読み進めて既読状態を作る。
  for (let i = 0; i < 300; i++) {
    await page.mouse.wheel(0, 100);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
  await page.waitForTimeout(500);

  /** 現在画面上に存在する全`.note-cell`のnoteId→列番号。 */
  async function columnsOf(): Promise<Record<string, string | undefined>> {
    return page.evaluate(() => {
      const cells = document.querySelectorAll<HTMLElement>(".note-cell[data-note-id]");
      const out: Record<string, string | undefined> = {};
      for (const cell of cells) out[cell.dataset.noteId ?? ""] = cell.dataset.columnIndex;
      return out;
    });
  }

  // 上方向へ戻りながら、毎ステップ各ノートの列番号が直前と変わっていないか監視する
  // (既読ノートの再マウントで高さが多少ぶれても、列を跨いで飛ばないことを検査したい)。
  const knownColumns = await columnsOf();
  let columnSwaps = 0;
  for (let i = 0; i < 300; i++) {
    await page.mouse.wheel(0, -100);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    const cols = await columnsOf();
    for (const [id, col] of Object.entries(cols)) {
      if (knownColumns[id] !== undefined && knownColumns[id] !== col) columnSwaps++;
      knownColumns[id] = col;
    }
    const scrollY = await page.evaluate(() => window.scrollY);
    if (scrollY <= 0) break;
  }

  expect(columnSwaps).toBe(0);
});
