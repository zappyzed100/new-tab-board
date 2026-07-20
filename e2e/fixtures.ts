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
    // new-tab overrideの初期Appは末尾の空ノート3件を非同期保存する。保存開始後すぐblankへ
    // 逃がしてもchrome.storage.set自体は継続し、テストのseedを後勝ちで空データへ戻す実害がある。
    // 固定時間待ちではなく、拡張ページを明示起動して初期保存がstorageへ反映されたことを
    // 条件として待ち、その後で全ページをblank化する。
    const [worker] = context.serviceWorkers().length
      ? context.serviceWorkers()
      : [await context.waitForEvent("serviceworker")];
    const extensionId = worker.url().split("/")[2];
    const startupPage = context.pages()[0] ?? (await context.newPage());
    await startupPage.goto(`chrome-extension://${extensionId}/index.html`);
    await startupPage.getByTestId("app-root").waitFor({ state: "visible" });
    await startupPage.waitForFunction(async () => {
      // NO-LOG: 隔離E2Eプロファイルの初期保存完了を待つfixture内の観察で、本番I/Oではない。
      const stored = await chrome.storage.local.get("localData");
      return (stored.localData as { notes?: unknown[] } | undefined)?.notes?.length === 3;
    });
    for (const page of context.pages()) {
      await page.goto("about:blank").catch(() => {});
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
