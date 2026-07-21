// notes.spec.ts — ノート編集エリアのE2E(SPEC.md §4.2)
// ノートタブは撤去済み(全件をボードで常時表示・末尾に常に空3つ)。追加=空ノートへ入力、
// リネーム/削除はペイン側で行う——それらの回帰は notes-board.spec.ts が担う。
import { expect, test } from "../fixtures";

test("同一PCの別タブへノート編集と削除が即時反映される", async ({ context, newTabUrl }) => {
  const firstTab = await context.newPage();
  const secondTab = await context.newPage();
  await Promise.all([firstTab.goto(newTabUrl), secondTab.goto(newTabUrl)]);
  await Promise.all([
    expect(firstTab.getByTestId("app-root")).toBeVisible(),
    expect(secondTab.getByTestId("app-root")).toBeVisible(),
  ]);

  const firstPane = firstTab.locator('[data-testid^="note-editor-area-"]').first();
  const paneTestId = await firstPane.getAttribute("data-testid");
  if (!paneTestId) throw new Error("先頭ノートのtestidを取得できません");
  await firstPane.locator(".cm-content").click();
  await firstTab.keyboard.type("タブ間即時同期テスト");

  await expect(secondTab.getByTestId(paneTestId).locator(".cm-content")).toContainText(
    "タブ間即時同期テスト",
  );

  const noteId = paneTestId.replace("note-editor-area-", "");
  await firstTab.getByTestId(`delete-note-${noteId}`).click();
  await expect(secondTab.getByTestId(paneTestId)).toHaveCount(0);
});

test("保存後に新しく開いたタブでも本文が見え、競合コピーを増やさない", async ({
  context,
  newTabUrl,
}) => {
  const firstTab = await context.newPage();
  await firstTab.goto(newTabUrl);
  await expect(firstTab.getByTestId("app-root")).toBeVisible();

  const firstPane = firstTab.locator('[data-testid^="note-editor-area-"]').first();
  const paneTestId = await firstPane.getAttribute("data-testid");
  if (!paneTestId) throw new Error("保存対象ノートのtestidを取得できません");
  await firstPane.locator(".cm-content").click();
  await firstTab.keyboard.type("新規タブでも読める保存済み本文");
  await expect(firstPane.locator(".cm-content")).toContainText("新規タブでも読める保存済み本文");

  const secondTab = await context.newPage();
  await secondTab.goto(newTabUrl);
  await expect(secondTab.getByTestId("app-root")).toBeVisible();
  const reopenedContent = secondTab.getByTestId(paneTestId).locator(".cm-content");
  await expect(reopenedContent).toBeVisible();
  await expect(reopenedContent).toContainText("新規タブでも読める保存済み本文");
  await expect(secondTab.getByText("(競合コピー)", { exact: false })).toHaveCount(0);
});

test("ダークモード時、ノート本文のカーソル色が黒固定にならずテーマに追従する", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 起動直後から末尾空3つが並ぶ。先頭ペインのエディタで確認する。
  const editor = page.locator('[data-testid="notepad-editor"]').first();
  await expect(editor).toBeVisible();

  await page.getByTestId("theme-select").click();
  await page.getByRole("option", { name: "ダーク" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await editor.locator(".cm-content").click();

  const cursorColor = await page.evaluate(() => {
    const cursor = document.querySelector(".cm-cursor");
    return cursor ? getComputedStyle(cursor).borderLeftColor : null;
  });
  // CM6のネイティブキャレットはcaret-colorが常にblack固定でダークモードで見えなく
  // なるバグがあった(drawSelection()導入+.cm-cursorへのvar(--text)指定で修正)。
  // 黒(rgb(0, 0, 0))固定へ回帰していないことを確認する。
  expect(cursorColor).not.toBeNull();
  expect(cursorColor).not.toBe("rgb(0, 0, 0)");
});

test("ダークモード時、保存済み本文の文字色は背景と十分なコントラストを持つ", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("theme-select").click();
  await page.getByRole("option", { name: "ダーク" }).click();

  const content = page.locator('[data-testid^="note-editor-area-"]').first().locator(".cm-content");
  await content.click();
  await page.keyboard.type("目で読める本文");
  const colors = await content.evaluate((element) => {
    const parse = (value: string) =>
      value
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number) ?? [0, 0, 0];
    let ancestor: Element | null = element;
    let background = "rgba(0, 0, 0, 0)";
    while (ancestor && background === "rgba(0, 0, 0, 0)") {
      background = getComputedStyle(ancestor).backgroundColor;
      ancestor = ancestor.parentElement;
    }
    return { foreground: parse(getComputedStyle(element).color), background: parse(background) };
  });
  const luminance = ([r, g, b]: number[]) => {
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const light = Math.max(luminance(colors.foreground), luminance(colors.background));
  const dark = Math.min(luminance(colors.foreground), luminance(colors.background));
  expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5);
});

test("ダークモード時、選択(Ctrl+A)の背景は白すぎず、白文字が見える濃さになる", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  await page.getByTestId("theme-select").click();
  await page.getByRole("option", { name: "ダーク" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  await firstPane.locator(".cm-content").click();
  await page.keyboard.type("選択テストの本文");
  await page.keyboard.press("Control+a");

  const bg = await firstPane
    .locator(".cm-selectionBackground")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) throw new Error(`予期しない選択色: ${bg}`);
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  // 既定の真っ白に近い選択(輝度~216)への回帰を防ぐ。濃いめ=白文字が読める。
  expect(luminance).toBeLessThan(180);
});

test("あるノートで選択中に別のノートを触ると、選択が解除される", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const panes = page.locator('[data-testid^="note-editor-area-"]');
  const first = panes.nth(0);
  const second = panes.nth(1);

  await first.locator(".cm-content").click();
  await page.keyboard.type("選択される本文");
  await page.keyboard.press("Control+a");
  await expect(first.locator(".cm-selectionBackground")).not.toHaveCount(0); // 選択が出る

  // 別のノートを触る(2つ目のエディタをクリック)と、1つ目の選択ハイライトは消える(blurで畳む)。
  await second.locator(".cm-content").click();
  await expect(first.locator(".cm-selectionBackground")).toHaveCount(0);
});

test("ノート編集エリアはフォーカスが外れた状態から本文の下の余白をクリックしても入力できる", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 起動直後から末尾空3つが並ぶ。先頭ペインのエディタで確認する。
  const firstPane = page.locator('[data-testid^="note-editor-area-"]').first();
  const editor = firstPane.locator('[data-testid="notepad-editor"]');
  await expect(editor).toBeVisible();

  // CM6のクリック→カーソル移動処理は.cm-content(contenteditable本体)にしか効かない。
  // .cm-content/.cm-scrollerが本文の行数分の高さ(1行分)にしかならず枠いっぱいに
  // 広がっていないと、本文より下の余白は裸の.cm-scroller/.cm-editorがクリックを
  // 受けることになり、フォーカスが外れた状態からは何も起きない(クリックしても
  // 入力できない)バグがあった。
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  // 全文検索バーが常時表示になった分ページが縦に伸びるため、素のmouse.clickで
  // 座標指定する前にビューポート内へ確実にスクロールしておく(要素はscrollIntoView
  // されるが、生座標クリックは自動スクロールしない)。
  await editor.scrollIntoViewIfNeeded();
  const box = await editor.boundingBox();
  if (!box) throw new Error("notepad-editor is not visible");
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.9);
  await page.keyboard.type("X");

  await expect(firstPane.getByTestId("notepad-status-bar")).toHaveText("行 1、列 2、1文字/全1文字");
});

test("下にスクロールしても、タブバーと全文検索のstickyヘッダは上端に留まる", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  // スクロールできる高さを確保するため、先頭ノートに多めの行を入れてページを縦に伸ばす。
  await page.locator('[data-testid^="note-editor-area-"]').first().locator(".cm-content").click();
  await page.keyboard.type("行\n".repeat(60));
  const head = page.getByTestId("note-sticky-head");
  await expect(head).toBeVisible();
  expect(await head.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");

  // 下へスクロールすると、stickyヘッダは視界上端(top≈0)に貼り付いて残る。
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect
    .poll(async () => head.evaluate((el) => Math.round(el.getBoundingClientRect().top)))
    .toBeLessThanOrEqual(1);
  const top = await head.evaluate((el) => Math.round(el.getBoundingClientRect().top));
  expect(top).toBeGreaterThanOrEqual(0);
});

test("A+/A−でノート本文の文字だけが拡縮し、他UIの文字サイズは変わらない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  const fontPx = (sel: string) =>
    page
      .locator(sel)
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

  const beforeEditor = await fontPx('[data-testid="notepad-editor"] .cm-editor');
  // ノート以外のUI文字の基準として、ショートカット一覧ボタンの文字サイズを見る。
  const beforeUi = await fontPx('[data-testid="open-shortcuts-modal"]');

  await page.getByTestId("note-font-increase").click();
  // 反映を待つ: サイズ表示ラベルが増える
  await expect(page.getByTestId("note-font-size-value")).toHaveText(`${beforeEditor + 1}px`);

  const afterEditor = await fontPx('[data-testid="notepad-editor"] .cm-editor');
  const afterUi = await fontPx('[data-testid="open-shortcuts-modal"]');
  expect(afterEditor).toBeGreaterThan(beforeEditor); // ノート本文は大きくなる
  expect(afterUi).toBe(beforeUi); // ノート以外(UI文字)のサイズは変わらない

  // 後始末: 元のサイズへ戻す(共有コンテキストのsync設定を汚さない)。
  await page.getByTestId("note-font-decrease").click();
  await expect(page.getByTestId("note-font-size-value")).toHaveText(`${beforeEditor}px`);
});

test("要約ボタンはGemini APIキー未設定なら案内を出し、勝手に実行しない", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  // E2Eプロファイルにはキーが無いので、要約を押すと案内メッセージが出る(外部API通信は起きない)。
  await page.locator('[data-testid^="summarize-"]').first().click();
  await expect(page.getByTestId("data-panel-message")).toContainText(
    "Gemini APIキーを設定してください",
  );
});

test("タグをふるボタンはGemini APIキー未設定なら案内を出す", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  await page.getByTestId("tag-all-notes").click();
  await expect(page.getByTestId("data-panel-message")).toContainText(
    "Gemini APIキーを設定してください",
  );
});

test("本日のGemini使用が450に達すると乗り換え警告バナーが出る", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();
  // 通常は警告は出ない。
  await expect(page.getByTestId("gemini-usage-warning")).toHaveCount(0);

  // 今日の使用回数を450にしてIndexedDBへ直接書き込む(日付キーはgeminiUsageDateKeyと同じ算出)。
  await page.evaluate(async () => {
    // NONDETERMINISM-EXEMPT: アプリは実クロックの「今日」(geminiUsageDateKey(now()))で使用量を
    // 集計するため、シード側も同じ実日付にしないとキーが噛み合わず警告が出ない。固定時刻へ置換する
    // 方が逆に噛み合わなくなる正当なケース(結果は日付に依らず常に「バナーが出る」で決定的)。
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("new-tab-board", 3);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("settings", "readwrite");
        tx.objectStore("settings").put({ date: today, count: 450 }, "geminiUsage");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
  });

  // 再読み込みするとマウント時に使用量を読み、しきい値到達で警告バナーが出る。
  await page.reload();
  await expect(page.getByTestId("gemini-usage-warning")).toBeVisible();
  await expect(page.getByTestId("gemini-usage-warning")).toContainText("GPT-OSS 120B");
});

test("スクロールジャンプの↑は上端寄り・↓は下端寄りに配置される", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const top = await page.getByTestId("scroll-to-top").boundingBox();
  const bottom = await page.getByTestId("scroll-to-bottom").boundingBox();
  if (!top || !bottom) throw new Error("scroll buttons not visible");
  // ↑は画面の上端寄り、↓は下端寄りに配置される(ユーザー指示: それぞれ端へ寄せる)。
  expect(top.y).toBeLessThan(60);
  expect(bottom.y + bottom.height).toBeGreaterThan(800 - 60);
  // 中央ではなく、上下に大きく離れている。
  expect(bottom.y).toBeGreaterThan(top.y + 200);
});
