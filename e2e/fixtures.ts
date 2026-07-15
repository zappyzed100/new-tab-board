// fixtures.ts — ビルド済み拡張機能を実際にロードするPlaywright fixture(GUARDRAILS.md §12.4)
import { test as base, chromium, type BrowserContext } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const extensionPath = join(repoRoot, "dist");

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  newTabUrl: string;
}>({
  // eslint-disable-next-line no-empty-pattern -- Playwrightのfixture APIの規約
  context: async ({}, use) => {
    if (!existsSync(extensionPath)) {
      throw new Error(
        `dist/ が見つからない(${extensionPath})。先に \`npm run build\` を実行してください。`,
      );
    }
    const userDataDir = mkdtempSync(join(tmpdir(), "new-tab-board-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    // 拡張機能がchrome_url_overrides.newtabを持つため、起動時にChromeが自動で開く最初の
    // タブも独立したApp.tsxインスタンスとして起動し、バックグラウンドで自分の初期状態
    // (空ノート等)をchrome.storage.localへ後から書き込みうる。この「幽霊タブ」がテスト用
    // タブ(newPage())とは別に生き残り、後勝ちの保存でテストが書いたデータを上書きして
    // reload後のアサーションが偶発的に失敗する実害を確認した。ヘッド付きChromeは全タブを
    // 閉じるとブラウザごと終了してしまう(newPage自体が失敗する)ため、閉じずabout:blankへ
    // 逃がしてApp.tsxのマウントを止める。起動直後は自動タブがまだ生成されていないことが
    // ある(Windows/headed Chromeの起動タイミング依存)ため、出現を少し待ってから2回blankし、
    // 遅れて現れる分も取りこぼさないようにする(1回だけだと約1/3の頻度で取りこぼし実害を確認)。
    if (context.pages().length === 0) {
      await context.waitForEvent("page", { timeout: 5000 }).catch(() => {});
    }
    for (const page of context.pages()) {
      await page.goto("about:blank").catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const page of context.pages()) {
      if (page.url() !== "about:blank") await page.goto("about:blank").catch(() => {});
    }
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    const [worker] = context.serviceWorkers().length
      ? context.serviceWorkers()
      : [await context.waitForEvent("serviceworker")];
    await use(worker.url().split("/")[2]);
  },

  newTabUrl: async ({ extensionId }, use) => {
    await use(`chrome-extension://${extensionId}/index.html`);
  },
});

export const expect = test.expect;
