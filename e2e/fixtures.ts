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
