// special.spec.ts — ⭐スター/スペシャル(保管棚)の回帰。スターでスペシャル一覧に出る、削除で凍結して
// 残る、タグ絞り込み(頻度降順チップ+自由入力)、サイドバー配置(TODOの下・タグ候補の上)を
// 数値/存在で検証(ユーザー指示: フォルダ方式からタグ方式へ変更)。
import { expect, test } from "../fixtures";

const panes = (page: import("@playwright/test").Page) =>
  page.locator('[data-testid^="note-editor-area-"]');

const idOf = async (pane: import("@playwright/test").Locator): Promise<string> => {
  const testid = await pane.getAttribute("data-testid");
  return testid!.replace("note-editor-area-", "");
};

test("スペシャルカードはTODOの下・タグ候補の上に置かれる", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const todo = await page.getByTestId("todo-list").boundingBox();
  const special = await page.getByTestId("special-panel").boundingBox();
  const tags = await page.getByTestId("tag-candidates-panel").boundingBox();
  if (!todo || !special || !tags) throw new Error("sidebar panels not visible");
  // 縦順: TODO → スペシャル → タグ候補(上端の順で確認)。
  expect(todo.y).toBeLessThan(special.y);
  expect(special.y).toBeLessThan(tags.y);
});

test("スペシャルのタグ入力欄はTODO入力欄と同じ配色になる(素の<input>だとテーマ色を拾わずTODOと食い違っていた不具合の回帰)", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const style = await page.evaluate(() => {
    function boxStyle(testid: string) {
      const el = document.querySelector(`[data-testid="${testid}"]`);
      const box = el?.closest(".rt-TextFieldRoot") ?? el?.parentElement;
      const cs = box ? getComputedStyle(box) : null;
      return { className: box?.className, backgroundColor: cs?.backgroundColor };
    }
    return { todo: boxStyle("todo-new-input"), special: boxStyle("special-tag-input") };
  });
  expect(style.special.className).toBe(style.todo.className);
  expect(style.special.backgroundColor).toBe(style.todo.backgroundColor);
});

test("スターでスペシャルに入り、削除すると凍結して一覧に残る", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const first = panes(page).first();
  const id = await idOf(first);
  // 本文を入れて非空にし、固有タイトルを付ける(末尾補充で消えないように)。
  await first.locator(".note-pane-title-input").fill("保管テスト");
  await first.locator(".cm-content").click();
  await page.keyboard.type("大事なメモ");

  // 初期はスペシャル空。
  await expect(page.getByTestId("special-empty")).toBeVisible();

  // ⭐スター → スペシャル一覧(live)に出る。
  await first.getByTestId(`star-note-${id}`).click();
  await expect(page.getByTestId(`special-entry-${id}`)).toBeVisible();
  await expect(page.getByTestId(`special-open-${id}`)).toHaveText("保管テスト");

  // ノートを削除 → スペシャルには「凍結」として残る(ノート一覧からは消える)。
  await first.getByTestId(`delete-note-${id}`).click();
  await expect(page.getByTestId(`note-editor-area-${id}`)).toHaveCount(0); // ボードから消えた
  await expect(page.getByTestId(`special-entry-${id}`)).toBeVisible(); // スペシャルには残る
  await expect(page.getByTestId(`special-frozen-${id}`)).toBeVisible(); // 凍結表示
});

test("タグの出現回数降順チップ・自由入力の両方でスペシャルを絞り込める", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  // 先にid1/id2を確定してから、以降は常にid基準のロケータを使う——本文入力で実測masonryの
  // 列振り分けが変わり、DOM順序(nth)基準のロケータは崩れ得るため(notes/CLAUDE.md参照)。
  const id1 = await idOf(panes(page).nth(0));
  const id2 = await idOf(panes(page).nth(1));
  const pane1 = () => page.getByTestId(`note-editor-area-${id1}`);
  const pane2 = () => page.getByTestId(`note-editor-area-${id2}`);
  await pane1().locator(".cm-content").click();
  await page.keyboard.type("京都旅行の計画");
  await pane2().locator(".cm-content").click();
  await page.keyboard.type("会議の議事録");
  await pane1().getByTestId(`star-note-${id1}`).click();
  await pane2().getByTestId(`star-note-${id2}`).click();
  await expect(page.getByTestId(`special-entry-${id1}`)).toBeVisible();
  await expect(page.getByTestId(`special-entry-${id2}`)).toBeVisible();

  // ノート更新はApp.tsx側でdebounceされた非同期saveLocalDataを経由するため、UIに反映された
  // 直後はまだchrome.storage.local側が古い可能性がある。直接書き込む前に、両ノートのspecial:true
  // が実際に永続化されるまで待つ(でなければ次のread-modify-writeが古い状態を読んでしまう)。
  await page.waitForFunction(
    ({ id1, id2 }) =>
      new Promise<boolean>((resolve) => {
        chrome.storage.local.get("localData", (result) => {
          type StoredNote = { id: string; special?: boolean };
          const notes = (result.localData as { notes: StoredNote[] } | undefined)?.notes ?? [];
          resolve(
            notes.some((n) => n.id === id1 && n.special === true) &&
              notes.some((n) => n.id === id2 && n.special === true),
          );
        });
      }),
    { id1, id2 },
  );

  // タグ付けはGemini経由のみ(E2E環境にAPIキー無し)のため、chrome.storage.localへ
  // 直接タグを注入してテストデータを用意する(タグ絞り込みUI自体の検証が目的)。
  await page.evaluate(
    ({ id1, id2 }) =>
      new Promise<void>((resolve) => {
        chrome.storage.local.get("localData", (result) => {
          type StoredNote = { id: string; tags?: string[] };
          const local = result.localData as { notes: StoredNote[] };
          local.notes = local.notes.map((n) =>
            n.id === id1
              ? { ...n, tags: ["旅行", "京都"] }
              : n.id === id2
                ? { ...n, tags: ["旅行", "仕事"] }
                : n,
          );
          chrome.storage.local.set({ localData: local }, () => resolve());
        });
      }),
    { id1, id2 },
  );
  await page.reload();
  await expect(page.getByTestId("app-root")).toBeVisible();
  await expect(page.getByTestId(`special-entry-${id1}`)).toBeVisible();
  await expect(page.getByTestId(`special-entry-${id2}`)).toBeVisible();

  // チップは出現回数降順で並ぶ(旅行は両ノートに付き2件、京都/仕事はそれぞれ1件)。
  const chipTexts = await page.getByTestId("special-tag-chip").allTextContents();
  expect(chipTexts[0]).toBe("旅行 2");
  expect(chipTexts.slice(1).sort()).toEqual(["京都 1", "仕事 1"]);

  // 「京都」チップ(id1だけに付くタグ)をクリック → 京都メモだけが残る。
  await page.getByTestId("special-tag-chip").filter({ hasText: "京都" }).click();
  await expect(page.getByTestId(`special-entry-${id1}`)).toBeVisible();
  await expect(page.getByTestId(`special-entry-${id2}`)).toHaveCount(0);

  // もう一度クリックで解除 → 両方戻る。
  await page.getByTestId("special-tag-chip").filter({ hasText: "京都" }).click();
  await expect(page.getByTestId(`special-entry-${id2}`)).toBeVisible();

  // 自由入力(Enter)でも絞り込める(仕事はid2だけに付くタグ)。
  await page.getByTestId("special-tag-input").fill("仕事");
  await page.getByTestId("special-tag-input").press("Enter");
  await expect(page.getByTestId(`special-entry-${id2}`)).toBeVisible();
  await expect(page.getByTestId(`special-entry-${id1}`)).toHaveCount(0);
});
