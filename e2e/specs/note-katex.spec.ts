// note-katex.spec.ts — ノートプレビューのKaTeX数式描画の回帰(ユーザー指示・2026-07-23)。
// バンドル時のサロゲート潰しでKaTeXの字句解析が壊れる不具合は本番ビルドでしか出ないため、
// 単体テストではなくここで実ビルドを貫通して検証する。
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

/** プレビューへ切り替える。CodeMirror上の表示は打鍵と同時に更新されるが、確定状態
 * (chrome.storage.local の note.content)への反映は非同期なので、`.cm-content` を見て切り替えると
 * **末尾が欠けた本文でプレビューが描画される**(プレビュー中はエディタが無く後から追いつかない)。
 * 確定状態が期待どおりになるまで待ってから切り替える(sleepは使わない)。 */
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

test("プレビューでKaTeXが数式を描画する($…$ / $$…$$)", async ({ context, newTabUrl }) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const formula = "解の公式 $x = \\frac{-b}{2a}$ を使う";
  const noteId = await typeIntoFirstNote(page, formula);
  await openPreview(page, noteId, formula);

  const previewPane = page.locator(`[data-testid="note-editor-area-${noteId}"]`);
  const katex = previewPane.locator(".katex").first();
  await expect(katex).toBeVisible();
  // 目に見える側(.katex-html)に生のLaTeXが残っていない=組版されている。MathMLの
  // <annotation> にはLaTeXソースが入るのが正しい仕様なので、そちらは対象にしない。
  await expect(previewPane.locator(".katex-html").first()).not.toContainText("frac");

  // 実際に組版されていることを数値で確認する(スクリーンショット目視で済ませない — CLAUDE.md)。
  // プレビュー直後はmasonry再配置とフォント読み込みで寸法が定まらないためポーリングして測る
  // (固定sleepは使わない)。
  await expect
    .poll(async () =>
      katex.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const mathml = el.querySelector(".katex-mathml");
        return {
          // 分数として構造化されている(素のテキストなら mfrac は無い)
          hasFrac: el.querySelectorAll(".mfrac").length > 0,
          // 実寸を持つ=描画されている。分数は1行の文字より背が高い。
          laidOut: rect.width > 10 && rect.height > parseFloat(getComputedStyle(el).fontSize),
          // MathMLはKaTeXのCSSで視覚的に潰される(読み上げ用)——数式が二重に見えていないこと
          mathmlHidden: mathml !== null && mathml.getBoundingClientRect().width < 2,
        };
      }),
    )
    .toEqual({ hasFrac: true, laidOut: true, mathmlHidden: true });
});

test("ブロック数式 $$…$$ は中央寄せのdisplay数式として描画される", async ({
  context,
  newTabUrl,
}) => {
  const page = await context.newPage();
  await page.goto(newTabUrl);
  await expect(page.getByTestId("app-root")).toBeVisible();

  const noteId = await typeIntoFirstNote(page, "$$");
  await page.keyboard.press("Enter");
  await page.keyboard.type("\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}");
  await page.keyboard.press("Enter");
  await page.keyboard.type("$$");
  await openPreview(page, noteId, "\\sum_{i=1}^{n}");

  const display = page.locator(".katex-display").first();
  await expect(display).toBeVisible();

  // display数式はプレビュー幅いっぱいのブロックとして置かれ、左右にはみ出さない。
  // 直後はmasonry再配置中で寸法が定まらないためポーリングして測る(固定sleepは使わない)。
  await expect
    .poll(async () =>
      display.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const host = el.closest('[data-testid="markdown-preview"]');
        const pv = host?.getBoundingClientRect();
        if (!pv || box.width === 0) return { measured: false };
        return {
          measured: true,
          // ブロック要素として横幅を持つ
          hasWidth: box.width > 10,
          // プレビュー枠からはみ出さない(横スクロールを起こさない)
          insideLeft: box.x >= pv.x - 1,
          insideRight: box.x + box.width <= pv.x + pv.width + 1,
          // 総和記号+分数なので1行の文字より明確に背が高い
          tallerThanLine: box.height > parseFloat(getComputedStyle(el).fontSize) * 1.5,
        };
      }),
    )
    .toEqual({
      measured: true,
      hasWidth: true,
      insideLeft: true,
      insideRight: true,
      tallerThanLine: true,
    });
});
