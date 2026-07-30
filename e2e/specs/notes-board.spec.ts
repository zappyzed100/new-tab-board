// notes-board.spec.ts — ノートボード(実測masonry)の回帰(2026-07-13にユーザー選択「最密」へ変更)
// ノートは全件を1枚のボードで常時表示し、App.tsxが各ペインの実高さを測って order(優先度)順に
// 「その時点で一番低い列。同高なら左」へ入れて縦積みする(最密詰め)。旧「i%列数で列固定」から変更。
// 2026-07-30: 列割当を「高い順に最短列(LPT法)+スティッキー」から「order順の貪欲法(見積もり
// 高さのみ使用)」へ変更(App.tsx noteLayout参照)。これにより先頭ノート(linear-index=0)は
// 必ず列0の先頭=実ピクセル上も左上に来ることが不変条件になった(ユーザー報告「ノートを上下する
// システムと実際の配置がずれてる。左上が一番上にしてほしい」への対応)。
// 検証の重心: ①列は横に並び重ならない②列内はgap詰めで縦に重ならない③列高さの差は最大の単一
// ノート高さ以下(order順貪欲法の理論保証)④先頭ノートは実ピクセル上も左上⑤列内・列間でlinear
// indexがorder順と整合⑥ピンで左上へ⑦一つ上へ⑧ドラッグ交換⑨末尾に常に空3つ。
import { expect, test } from "../fixtures";

// ノートタブは撤去済み。ノート名はペイン先頭の枠なし見出し(.note-pane-title-input の value)で持つ。
// 実測masonryは列配置を高さで決めるため i%列数 では順序を復元できない——各セルの data-linear-index
// (order列での位置)で論理的な並び順を読む。
const noteTitlesLinear = async (page: import("@playwright/test").Page): Promise<string[]> => {
  const pairs = await page.locator(".note-cell[data-linear-index]").evaluateAll((cells) =>
    cells.map((c) => ({
      idx: Number(c.getAttribute("data-linear-index")),
      title: (c.querySelector(".note-pane-title-input") as HTMLInputElement | null)?.value ?? "",
    })),
  );
  return pairs.sort((a, b) => a.idx - b.idx).map((p) => p.title);
};

// ノート数(=ペイン数)。
const panes = (page: import("@playwright/test").Page) =>
  page.locator('[data-testid^="note-editor-area-"]');

// 指定した列に属するノートペインのlocator。列は<div>ではなくセルの絶対配置で表現するため
// (列ごとの入れ物に入れるとノート増減で再マウントされ入力が壊れる——layout.css参照)、
// セルの data-column-index で拾う。DOM順はorder順なので .first() は「その列の一番上」。
const columnPanes = (page: import("@playwright/test").Page, col: number) =>
  page.locator(`.note-cell[data-column-index="${col}"] [data-testid^="note-editor-area-"]`);

// 不変条件①(先頭ノートは実ピクセル上も左上)の実測ヘルパー: 全セルの中でtopが最小の集合を取り、
// その中でleftが最小のセルを「左上」と定義する(同率tieは許容——同じtopの他列があってよいが、
// それらよりleftが小さいことだけを保証する)。CLAUDE.mdの指示によりgetBoundingClientRect()の
// 実測で判定し、スクリーンショット目視には頼らない。
const topLeftCell = async (
  page: import("@playwright/test").Page,
): Promise<{ linear: string; column: string }> =>
  page.locator(".note-cell[data-column-index][data-linear-index]").evaluateAll((cells) => {
    const rects = cells.map((c) => ({
      linear: c.getAttribute("data-linear-index") ?? "",
      column: c.getAttribute("data-column-index") ?? "",
      rect: c.getBoundingClientRect(),
    }));
    const minTop = Math.min(...rects.map((r) => r.rect.top));
    const topmost = rects.filter((r) => r.rect.top <= minTop + 1);
    topmost.sort((a, b) => a.rect.left - b.rect.left);
    return { linear: topmost[0].linear, column: topmost[0].column };
  });

test("実測masonry: 列は重ならず・列内はgap詰め・列高さがほぼ揃う(最密)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 }); // 3列に十分な幅
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 先頭ノートへ大量の行を入れて「とても縦に長い」ノートを1つ作る(→末尾空も補充され複数ノートになる)。
  await columnPanes(page, 0).first().locator(".cm-content").click();
  await page.keyboard.type("長いノート\n".repeat(40));
  // さらに短いノートを数個増やして masonry を働かせる(空を非空化すると末尾へ空が補充される)。
  for (let i = 0; i < 3; i++) {
    const empty = page.locator('[data-testid^="note-editor-area-"]').last();
    await empty.locator(".cm-content").click();
    await page.keyboard.type(`短${i}`);
  }
  await expect.poll(async () => panes(page).count()).toBeGreaterThanOrEqual(5);

  // 各セルのrectを列ごとに束ね、実測で不変条件を検証する(CLAUDE.md: 目視でなく数値で)。
  // 位置はJSが実測高さから計算してtopへ書くため、測定が収束するまで数フレームかかる——
  // 一発取りだと測定途中を掴んでflakyになるので、違反リストが空になるまでpollする。
  const violations = async (): Promise<string[]> =>
    page.locator(".note-cell[data-column-index]").evaluateAll((cells) => {
      const columns = new Map<string, DOMRect[]>();
      for (const cell of cells) {
        const key = cell.getAttribute("data-column-index") ?? "?";
        const pane = cell.querySelector('[data-testid^="note-editor-area-"]');
        if (!pane) continue;
        (columns.get(key) ?? columns.set(key, []).get(key)!).push(pane.getBoundingClientRect());
      }
      const cols = [...columns.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
      const bad: string[] = [];
      if (cols.length < 2) bad.push(`列が${cols.length}つしかない(複数列に分散していない)`);
      // ① 隣り合う列は横に並んで重ならない(左の列の右端 ≤ 右の列の左端)。
      for (let c = 0; c + 1 < cols.length; c++) {
        const leftRight = Math.max(...cols[c][1].map((r) => r.right));
        const rightLeft = Math.min(...cols[c + 1][1].map((r) => r.left));
        if (leftRight > rightLeft + 1) bad.push(`列${c}と列${c + 1}が横に重なる`);
      }
      // ② 列内はgap詰めで縦に重ならない(各ペインの上端 ≥ 前ペインの下端。かつ隙間は詰まっている)。
      for (const [key, rects] of cols) {
        const sorted = [...rects].sort((a, b) => a.top - b.top);
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].top < sorted[i - 1].bottom - 1) bad.push(`列${key}の${i}番目が縦に重なる`);
          if (sorted[i].top > sorted[i - 1].bottom + 40) bad.push(`列${key}の${i}番目が離れすぎ`);
        }
      }
      // ③ 最密の証拠: 列の高さがほぼ揃う。列の下端のばらつきが、一番高い単一ノートの高さ未満
      //    (=全部を1列に積まず最短列へ分散している。旧「i%列数」ではここが破れていた)。
      const bottoms = cols.map(([, rects]) => Math.max(...rects.map((r) => r.bottom)));
      const tops = cols.map(([, rects]) => Math.min(...rects.map((r) => r.top)));
      const tallest = Math.max(...cols.flatMap(([, rects]) => rects.map((r) => r.height)));
      if (Math.max(...bottoms) - Math.min(...bottoms) >= tallest) bad.push("列高さが揃っていない");
      // 列の上端は揃っている(各列の先頭は top=0 から積む)。
      if (Math.max(...tops) - Math.min(...tops) >= 2) bad.push("列の上端が揃っていない");
      return bad;
    });
  await expect.poll(violations).toEqual([]);
});

test("長文ノートが途中にあっても、先頭ノートが実ピクセル上の左上を保ち、列の先頭はorder順に並ぶ(2026-07-30の回帰)", async ({
  context,
  newTabUrl,
}) => {
  // 盤面を**読み込み直した直後**(＝全ノートが未割当の状態から一度に列を決める)が旧実装の
  // 症状が出る条件。旧「高い順に最短列(LPT法)」では、まだ空の列0を**最長ノート**が取るため、
  // order先頭のノートが左上から押し出されていた(ユーザー報告「ノートを上下するシステムと
  // 実際の配置がずれてる」)。order順の貪欲法なら、全列が高さ0の状態から先頭ノートが最初に
  // 置かれる=必ず列0の先頭になる。
  const worker = context.serviceWorkers()[0];
  const page = context.pages()[0];
  if (!page) throw new Error("E2E fixtureのblankページが見つかりません");

  // 5番目(index=4)だけ数千行の長文。他は短文。入力ではなくfixture投入にするのは、
  // 「未割当の全件をまとめて割り当てる」経路を通すため(入力で作ると1件ずつ割り当たる)。
  const notes = Array.from({ length: 9 }, (_, i) => ({
    id: `topleft-note-${i}`,
    title: `ノート${i}`,
    content: Array.from({ length: i === 4 ? 2000 : 10 }, (_, l) => `${l}: 本文の一行です。`).join(
      "\n",
    ),
    pinned: false,
    order: i,
    createdAt: i,
    updatedAt: i,
  }));
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
            theme: "dark",
            searchEngine: "https://www.google.com/search?q=%s",
          },
        },
      });
    },
    { notes },
  );

  await page.setViewportSize({ width: 1900, height: 1000 }); // 3列に十分な幅
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect.poll(() => page.locator(".cm-editor").count()).toBeGreaterThan(0);

  // 実測(CLAUDE.md): 先頭ノート(linear-index=0)が列0かつ実ピクセル上の左上にある。
  await expect.poll(() => topLeftCell(page)).toEqual({ linear: "0", column: "0" });

  // 列ごとのlinear index(DOM順=常にorder順)。①列内は単調増加②各列の先頭は列0<列1<列2
  // (order順貪欲+同高tie左により、最初の3件が左から順に各列の先頭を取る)。
  const cols = await page
    .locator(".note-cell[data-column-index][data-linear-index]")
    .evaluateAll((cells) => {
      const byCol = new Map<string, number[]>();
      for (const c of cells) {
        const col = c.getAttribute("data-column-index") ?? "?";
        const arr = byCol.get(col) ?? [];
        arr.push(Number(c.getAttribute("data-linear-index")));
        byCol.set(col, arr);
      }
      return [...byCol.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, arr]) => arr);
    });
  expect(cols.length).toBe(3);
  for (const arr of cols) {
    for (let i = 1; i < arr.length; i++) expect(arr[i]).toBeGreaterThan(arr[i - 1]);
  }
  expect(cols[0][0]).toBeLessThan(cols[1][0]);
  expect(cols[1][0]).toBeLessThan(cols[2][0]);
});

/** 決定的な疑似乱数(シード固定。AGENTS.md §8 test-nondeterminism)。 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("長さが極端に違うノートでも列の高さが揃う(片側だけ数万px余る=真っ黒の回帰・2026-07-29)", async ({
  context,
  newTabUrl,
}) => {
  // 28件を一度マウントし切るまでスクロールするため既定の30秒では足りない。
  test.slow();
  const worker = context.serviceWorkers()[0];
  const page = context.pages()[0];
  if (!page) throw new Error("E2E fixtureのblankページが見つかりません");

  // 実機の盤面に寄せる: 3割が数千行の長文、残りは短文。
  const rand = mulberry32(20260729);
  const notes = Array.from({ length: 28 }, (_, i) => {
    const lineCount =
      rand() < 0.3 ? 1500 + Math.floor(rand() * 2500) : 20 + Math.floor(rand() * 200);
    return {
      id: `balance-note-${i}`,
      title: `ノート${i}`,
      content: Array.from(
        { length: lineCount },
        (_, l) => `${l}: これは日本語の本文の一行です。`,
      ).join("\n"),
      pinned: false,
      order: i,
      createdAt: i,
      updatedAt: i,
    };
  });
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
            theme: "dark",
            searchEngine: "https://www.google.com/search?q=%s",
          },
        },
      });
    },
    { notes },
  );

  await page.setViewportSize({ width: 1900, height: 1000 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect.poll(() => page.locator(".cm-editor").count()).toBeGreaterThan(0);
  await page.waitForTimeout(1000);

  // 全ノートを一度マウントさせて実測高さを行き渡らせる(窓化のため下まで読む必要がある)。
  for (let i = 0; i < 120; i++) {
    await page.mouse.wheel(0, 1200);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  }
  await page.waitForTimeout(2000);

  const balance = await page.evaluate(() => {
    const byColumn = new Map<string, number>();
    let tallestNote = 0;
    for (const cell of document.querySelectorAll<HTMLElement>(".note-cell[data-note-id]")) {
      const col = cell.dataset.columnIndex ?? "0";
      const height = cell.getBoundingClientRect().height;
      tallestNote = Math.max(tallestNote, height);
      const bottom = parseFloat(cell.style.top || "0") + height;
      byColumn.set(col, Math.max(byColumn.get(col) ?? 0, bottom));
    }
    const bottoms = [...byColumn.values()];
    const board = Math.max(...bottoms);
    return {
      imbalance: Math.max(...bottoms) - Math.min(...bottoms),
      board,
      columns: bottoms.length,
      tallestNote,
    };
  });

  expect(balance.columns).toBe(3);
  // order順貪欲法(2026-07-30〜)の理論保証: 最終的に最大列になった列は、その最後のノートを
  // 積む直前の時点でその時点の最小列だった(さもなくば別の列に積まれたはず)ため、最大列と他列の
  // 差はその最後のノート1件の見積もり高さを超えない(list schedulingの標準的性質。処理順が
  // order順=到着順であってもLPT法と同様に成り立つ)。旧「board*0.15」(盤面全体への割合)は、
  // 1件が盤面の大半を占める偏った構成(本テストのように数千行のノートが混ざる場合)では新
  // アルゴリズムの正当な出力でも超えうる——「新アルゴリズムではboard*0.15は保証できない」——
  // ため、理論保証に沿った「最大の単一ノート高さ+余裕」へ緩めた。
  // 旧「一律520pxの見積もり」の退行(実測: 偏り62,825px/盤面147,102px、当時の最大ノート高さ
  // 69,852px)は、素朴な「偏り<最大ノート高さ」ではまさに通ってしまっていた(62,825<69,852。
  // これがboard*0.15を採用した理由そのもの)。つまり当時の実測値そのものをこの新条件で
  // ピンポイント再現しても検出できるとは限らない——ただし当時の破綻は「見積もりが実測と
  // 無関係(一律520px)」という割当と実測が無相関の病的ケースに限って起きたもので、
  // estimateNoteHeightが実測と相関する(較正比1.04〜1.07)本実装で同程度に壊れれば偏りは
  // もっと悪化するはずであり、その規模なら本条件でも検知できる。理論的に正しい条件へ寄せた
  // トレードオフとして「62,825px」という特定の数値そのものの再検出保証は失っていることを
  // 明記しておく。
  const GAP_ALLOWANCE = 16 * 4; // --space-3(GAP)4つぶん。較正誤差・端数の余裕。
  expect(balance.imbalance).toBeLessThan(balance.tallestNote + GAP_ALLOWANCE);
});

test("空ノートの2番目に入力しても、そのノートは動かず打鍵が失われない(2026-07-23の回帰)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 }); // 3列=空3つが3列に散る
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3); // 起動直後は空3つ(ノートA/B/C)

  // 2番目の空ノート(ノートB)を対象にする。以前はここへ入力した瞬間、末尾補充の巻き添えで
  // 前のノートAが削除され、盤面が繰り上がってこのペインが別の列へ飛び、CodeMirrorが
  // 再マウントされてフォーカスと以降の打鍵が失われた(ユーザー報告)。
  const cellB = page.locator('.note-cell[data-linear-index="1"]');
  const editorB = cellB.locator(".cm-editor");
  const before = {
    linear: await cellB.getAttribute("data-linear-index"),
    column: await cellB.getAttribute("data-column-index"),
    titles: await noteTitlesLinear(page),
  };
  // 同じDOMノードが生き残ったかを見る印(Reactの管理外の属性なので再マウント時だけ消える)。
  await editorB.evaluate((el) => el.setAttribute("data-remount-probe", "kept"));

  await cellB.locator(".cm-content").click();
  await page.keyboard.type("あいうえお");

  // ①打鍵が1文字も落ちていない(以前は1文字目でフォーカスを失い、残りが消えた)。
  await expect(cellB.locator(".cm-content")).toHaveText("あいうえお");
  // ②末尾へ空が1つ補充される(空は常に3つ)が、前のノートAは消えていない。
  await expect(panes(page)).toHaveCount(4);
  expect(await noteTitlesLinear(page)).toEqual([...before.titles, "ノートD"]);
  // ③入力中ペインの論理位置(linear)も表示上の列も動かない。
  expect(await cellB.getAttribute("data-linear-index")).toBe(before.linear);
  expect(await cellB.getAttribute("data-column-index")).toBe(before.column);
  // ④CodeMirrorは同じDOMノードのまま(再マウントされていない)＝カーソルが飛ばない。
  await expect(editorB).toHaveAttribute("data-remount-probe", "kept");
  expect(await editorB.evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

test("各ノートの操作ボタンは3行以内に収まる(狭い列でも)", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 600, height: 900 }); // 2列=1列あたり狭い(約280px)
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const first = page.locator('[data-testid^="note-editor-area-"]').first();
  const id = (await first.getAttribute("data-testid"))!.replace("note-editor-area-", "");
  const testids = [
    `move-note-up-${id}`,
    `move-note-down-${id}`,
    `toggle-preview-${id}`,
    `toggle-history-${id}`,
    `summarize-${id}`,
    `extract-todos-${id}`,
    `tag-note-${id}`,
    `copy-note-${id}`,
    `reset-note-${id}`,
    `delete-note-${id}`,
  ];
  const ys: number[] = [];
  for (const t of testids) {
    const box = await first.getByTestId(t).boundingBox();
    if (!box) throw new Error(`button ${t} not visible`);
    ys.push(box.y);
  }
  // Y座標を行にまとめる(12px以内は同じ行とみなす)。行数=distinctな行の数。
  const rows: number[] = [];
  for (const y of ys.sort((a, b) => a - b)) {
    if (rows.length === 0 || y - rows[rows.length - 1] > 12) rows.push(y);
  }
  expect(rows.length).toBeLessThanOrEqual(3);
});

test("コードコメントが画面に描画されない(JSX子要素内の // 漏れの回帰・2026-07-23)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3); // 空3つ=ユーザー入力に「//」は無い状態で見る

  // JSXの子要素の位置に書かれた「// コメント」はコメントにならずテキストノードとして
  // 描画される(実バグ: note-board の直前に「// DOMの並びは…」が丸ごと表示されていた)。
  // 画面上の全テキストノードから「//」で始まるものを探し、1つも無いことを実測する。
  const leaked = await page.getByTestId("app-root").evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const bad: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim() ?? "";
      if (text.startsWith("//")) bad.push(text.slice(0, 60));
    }
    return bad;
  });
  expect(leaked).toEqual([]);
});

test("空ノートと非空ノートで背景色が変わる(見分けられる)", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3); // 起動直後は空3つ

  // 先頭ノートに文字を入れて非空にする(末尾へ空が1つ補充され4つになる)。
  const first = page.locator('[data-testid^="note-editor-area-"]').first();
  await first.locator(".cm-content").click();
  await page.keyboard.type("なにか");
  await expect(first).not.toHaveAttribute("data-empty", /.*/); // 非空になった(属性が消える)
  const last = page.locator('[data-testid^="note-editor-area-"]').last();
  await expect(last).toHaveAttribute("data-empty", "true"); // 末尾は空のまま(Reactはbool trueを"true"で出す)

  const bgOf = (loc: import("@playwright/test").Locator) =>
    loc.evaluate((el) => getComputedStyle(el).backgroundColor);
  const nonEmptyBg = await bgOf(first);
  const emptyBg = await bgOf(last);
  // 背景色が実際に異なる(単なる属性でなく描画に効いている)。透明でもない。
  expect(nonEmptyBg).not.toBe(emptyBg);
  expect(nonEmptyBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(emptyBg).not.toBe("rgba(0, 0, 0, 0)");
});

test("データ操作ツールバーとノート域の間に区切り線がある", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("toggle-data-panel").click();

  const divider = page.getByTestId("toolbar-divider");
  await expect(divider).toBeVisible();
  const dRect = await divider.boundingBox();
  const flushRect = await page.getByTestId("data-flush-nas").boundingBox();
  const fontRect = await page.getByTestId("note-font-decrease").boundingBox();
  if (!dRect || !flushRect || !fontRect) throw new Error("layout elements not visible");

  // 区切り線は「今すぐNASへ書き出し」ボタンの下・「ノート文字サイズ(A−)」の上にある。
  expect(dRect.y).toBeGreaterThanOrEqual(flushRect.y + flushRect.height - 1);
  expect(dRect.y + dRect.height).toBeLessThanOrEqual(fontRect.y + 1);
  // 全幅に近い横線(小さなボタンよりずっと広い)。
  expect(dRect.width).toBeGreaterThan(flushRect.width * 3);
  // 実際に上ボーダーが描かれている(border-top-width > 0)。
  const borderTop = await divider.evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(parseFloat(borderTop)).toBeGreaterThan(0);
});

test("md/txtファイルをノートへドロップすると本文が取り込まれる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  const first = page.locator('[data-testid^="note-editor-area-"]').first();

  // DataTransfer に .md ファイルを積んで drop を発火(capture の取り込みハンドラが拾う)。
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["取り込みテスト本文"], "memo.md", { type: "text/markdown" }));
    return d;
  });
  await first.dispatchEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true });
  await first.dispatchEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true });

  // 空ノートだったので丸ごと置換され、本文がエディタに反映される。
  await expect(first.locator(".cm-content")).toContainText("取り込みテスト本文");
});

test("末尾には常に空ノートが3つ確保される(先頭を埋めると新しい空が末尾へ増える)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 起動直後は空ノートちょうど3つ(ノートA/B/C)。
  await expect(panes(page)).toHaveCount(3);

  // 先頭(左上)のノートに本文を入れると、末尾の空が2つに減るため1つ補充されて4つになる。
  await columnPanes(page, 0).first().locator(".cm-content").click();
  await page.keyboard.type("なにか書いた");
  await expect(panes(page)).toHaveCount(4);
});

test("削除でorderが疎な盤面でも、空ノートへの一文字目で補充ノートが編集位置へ割り込まない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 削除はorderを振り直さない——「件数(4) < 最大order(6)」の疎盤面を直接seedする
  // (2026-07-22: 新しいタブで最初の空ノートに書き始めた瞬間、補充ノートがorder=件数で
  //  生まれて編集位置へ割り込み、一文字目の入ったノートが右へ飛んで見えた実バグ)。
  await page.evaluate(async () => {
    // NO-LOG: E2Eの疎order盤面seedで、本番I/Oではない。
    const mk = (id: string, title: string, order: number, content: string) => ({
      id,
      title,
      content,
      pinned: false,
      order,
      createdAt: 1,
      updatedAt: 1,
    });
    await chrome.storage.local.set({
      localData: {
        notes: [
          mk("real-1", "会議メモ", 0, "本文"),
          mk("empty-e", "ノートE", 4, ""),
          mk("empty-f", "ノートF", 5, ""),
          mk("empty-g", "ノートG", 6, ""),
        ],
      },
    });
  });
  await page.reload();
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect
    .poll(async () => noteTitlesLinear(page))
    .toEqual(["会議メモ", "ノートE", "ノートF", "ノートG"]);

  // 最初の空ノートEを選んで一文字目を入力(ユーザーの実操作の再現)。
  const paneE = page.locator('[data-testid="note-editor-area-empty-e"]');
  await paneE.locator(".cm-content").click();
  await page.keyboard.type("あ");

  // 補充は表示末尾(ノートA=未使用の先頭タイトル)に付き、編集中ノートEは位置1のまま。
  await expect
    .poll(async () => noteTitlesLinear(page))
    .toEqual(["会議メモ", "ノートE", "ノートF", "ノートG", "ノートA"]);
  // 一文字目は選んだノートEに入ったまま(右のノートへ飛ばない)。
  await expect(paneE.locator(".cm-content")).toHaveText("あ");
});

test("ピン留めしたノートは最優先で左上(順序列の先頭)に来る", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const before = await noteTitlesLinear(page); // [ノートA, ノートB, ノートC]
  const lastTitle = before[before.length - 1];

  // 末尾のノート(col2の先頭 = 3件中3番目)をピン留めする。
  await columnPanes(page, 2)
    .first()
    .getByTestId(/^pin-note-/)
    .click();

  // 順序列の先頭 = col0の先頭ペイン。そこが今ピンしたノート(旧末尾)になる。
  await expect.poll(async () => (await noteTitlesLinear(page))[0]).toBe(lastTitle);
  // 実測(CLAUDE.md): 論理的な先頭だけでなく、実ピクセル上も列0の左上へ来ている(不変条件①)。
  await expect.poll(() => topLeftCell(page)).toEqual({ linear: "0", column: "0" });
});

test("「上へ」で順序列の1つ前のノートと入れ替わる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const before = await noteTitlesLinear(page); // [A, B, C]
  // 2番目(col1の先頭)のノートを1つ上へ → 先頭と入れ替わる。
  await columnPanes(page, 1)
    .first()
    .getByTestId(/^move-note-up-/)
    .click();

  await expect.poll(async () => noteTitlesLinear(page)).toEqual([before[1], before[0], before[2]]);
  // 実測(CLAUDE.md): 入れ替わった新しい先頭ノートは実ピクセル上も列0の左上へ来ている
  // (不変条件①・orderに配置が追従することの実測)。
  await expect.poll(() => topLeftCell(page)).toEqual({ linear: "0", column: "0" });
});

test("先頭ノートの「上へ」は無効(これ以上上がない)", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  await expect(
    columnPanes(page, 0)
      .first()
      .getByTestId(/^move-note-up-/),
  ).toBeDisabled();
});

test("ドラッグつまみでノートの位置を入れ替えられる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const before = await noteTitlesLinear(page); // [A, B, C]
  // 末尾ノート(col2先頭)のつまみを掴み→先頭ノート(col0先頭)のヘッダへドロップ → 末尾が先頭位置へ。
  // ネイティブDnDのマウス擬似はPlaywrightで不安定なため、DnDイベントを直接dispatchして
  // ハンドラ(onDragStart=refに掴んだid / onDrop=refのidをその位置へ移動)を決定的に発火させる。
  const handleLast = columnPanes(page, 2).first().locator('[data-testid^="note-drag-handle-"]');
  const dropTargetFirst = columnPanes(page, 0)
    .first()
    .locator('[data-testid^="note-drag-handle-"]');
  await handleLast.dispatchEvent("dragstart");
  await dropTargetFirst.dispatchEvent("dragover");
  await dropTargetFirst.dispatchEvent("drop");

  await expect.poll(async () => (await noteTitlesLinear(page))[0]).toBe(before[2]);
});

test("ノートペイン先頭でノート名を編集できる(枠なし見出し・左上配置)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  const title = firstPane.locator(".note-pane-title-input");
  await title.fill("議事録");

  // 先頭ノートのタイトルが更新される(linear orderの先頭=議事録)。
  await expect.poll(async () => (await noteTitlesLinear(page))[0]).toBe("議事録");

  // レイアウト実測(CLAUDE.md): ①名前は一番左上=操作ボタン行(優先度)より上・左端が揃う
  // ②枠が見えない ③文字が大きい ④チェックとピンは名前と同じ行の右側・ピンはアイコンだけ(細い)。
  const titleBox = await title.boundingBox();
  const priorityBox = await firstPane.locator('[data-testid^="move-note-up-"]').boundingBox();
  const checkBox = await firstPane.locator('[data-testid^="check-note-"]').boundingBox();
  const pinBox = await firstPane.locator('[data-testid^="pin-note-"]').boundingBox();
  if (!titleBox || !priorityBox || !checkBox || !pinBox) {
    throw new Error("layout elements not visible");
  }
  // ①名前は操作ボタン行より上の行にあり、左端が揃う(＝一番左上)。
  expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(priorityBox.y + 1);
  expect(titleBox.x).toBeLessThanOrEqual(priorityBox.x + 4);
  // ②枠が見えない(borderの太さが0)。
  const border = await title.evaluate((el) => {
    const s = getComputedStyle(el);
    return { top: s.borderTopWidth, left: s.borderLeftWidth };
  });
  expect(border).toEqual({ top: "0px", left: "0px" });
  // ③文字は少し大きい(1.15rem ≈ 18px)。
  const titleFontPx = await title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(titleFontPx).toBeGreaterThan(15);
  // ④チェックとピンは名前と同じ行(縦に重なる)で名前より右、ピンはチェックより右端側。
  const sameRow = (b: { y: number; height: number }) =>
    b.y < titleBox.y + titleBox.height && titleBox.y < b.y + b.height;
  expect(sameRow(checkBox) && sameRow(pinBox)).toBe(true);
  expect(checkBox.x).toBeGreaterThan(titleBox.x);
  expect(pinBox.x).toBeGreaterThan(checkBox.x);
  expect(pinBox.width).toBeLessThan(48); // ピンは説明なしのアイコンだけ=細い
});

test("ノートペインの削除ボタンでそのノートを削除できる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  // 末尾補充で名前が復活しないよう、英字連番でない固有名に変えてから削除する。
  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  await firstPane.locator(".note-pane-title-input").fill("削除対象テスト");
  await expect.poll(async () => noteTitlesLinear(page)).toContain("削除対象テスト");

  await firstPane.locator('[data-testid^="delete-note-"]').click();
  await expect.poll(async () => noteTitlesLinear(page)).not.toContain("削除対象テスト");
});

test("ノート名の右のチェックはトグルできるが、ノートの見た目には連動しない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  const check = firstPane.locator('[data-testid^="check-note-"]');

  // 初期は未チェック。見た目に連動する属性(data-done)は廃止済みで付かない。
  await expect(check).toHaveAttribute("data-state", "unchecked");
  expect(await firstPane.getAttribute("data-done")).toBeNull();
  const opacityBefore = await firstPane.evaluate((el) => getComputedStyle(el).opacity);

  await check.click();
  // チェック状態はトグルされるが、ノートの透明度(見た目)は変わらない=何とも連動しない。
  await expect(check).toHaveAttribute("data-state", "checked");
  expect(await firstPane.getAttribute("data-done")).toBeNull();
  const opacityAfter = await firstPane.evaluate((el) => getComputedStyle(el).opacity);
  expect(opacityAfter).toBe(opacityBefore);
});

test("初期化ボタンでノートの内容が空に戻る(削除とは違いノートは残る)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(panes(page)).toHaveCount(3);

  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  const firstPaneId = (await firstPane.getAttribute("data-testid"))!;
  await firstPane.locator(".cm-content").click();
  await page.keyboard.type("消される予定の本文");
  await expect(firstPane.locator(".cm-content")).toHaveText("消される予定の本文");

  await firstPane.locator('[data-testid^="reset-note-"]').click();
  // 本文はCM6ごと再マウントされて空になるが、**そのノート自体は消えない**(削除ではない)。
  // 以前は空へ戻った瞬間に「空プレースホルダが4つ」となり、order の低い方=初期化した当の
  // ノートが間引かれて消えていた(2026-07-23。間引きは末尾側からに変更)。
  // 初期化後の再マウントで古いドラフトを拾って本文が残らないこと(2026-07-24の回帰:
  // 同期clearDraftの直後に遅延したCM6 updateが古い本文を setDraft し直し、再マウントがそれを
  // 拾って初期化が空にならないCIレースがあった。replaceFromNoteContent で note.content を採る)。
  await expect(page.getByTestId(firstPaneId).locator(".cm-content")).toHaveText("");
  // 本文が空に戻ったので、ペインは空ノートの見た目(data-empty)になる。
  await expect(page.getByTestId(firstPaneId)).toHaveAttribute("data-empty", "true");
  // 空へ戻ったぶん末尾の余剰プレースホルダが1つ減り、空はまた常にちょうど3つになる。
  await expect(panes(page)).toHaveCount(3);

  // 初期化直後の古いCM6インスタンスからの書き込みを止める抑止(suppressContentChangeRef)は、
  // 新インスタンスの再マウント完了で必ず解除されなければならない——解除されないと、
  // 初期化した直後にそのノートへ書いた内容が一切保存されなくなる(2026-07-27の回帰。
  // 意図的置換4箇所で古いCM6の遅延イベントがnote.contentを上書きするレースを断つ修正の対)。
  await page.getByTestId(firstPaneId).locator(".cm-content").click();
  await page.keyboard.type("初期化後の新しい本文");
  await expect(page.getByTestId(firstPaneId).locator(".cm-content")).toHaveText(
    "初期化後の新しい本文",
  );
});
