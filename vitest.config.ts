// vitest.config.ts — 単体テスト設定(e2e/はPlaywrightの領域なのでvitestの収集対象から除外)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
