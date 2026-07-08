// playwright.config.ts — E2E設定(拡張機能ロードにはheaded実行が必須 — GUARDRAILS.md §11)
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
  },
});
