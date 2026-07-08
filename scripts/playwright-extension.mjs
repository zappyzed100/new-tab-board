// playwright-extension.mjs — 拡張機能を読み込んだpersistent context起動の共通ヘルパー(GUARDRAILS.md §12.2〜§12.4)
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const extensionPath = join(repoRoot, "dist");
export const userDataDir = join(repoRoot, ".pw-user-data");

export async function launchWithExtension() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const [worker] = context.serviceWorkers().length
    ? context.serviceWorkers()
    : [await context.waitForEvent("serviceworker")];
  const extensionId = worker.url().split("/")[2];
  return { context, extensionId, worker };
}

export async function openNewTabPage(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  return page;
}
