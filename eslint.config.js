// eslint.config.js — lint昇格の設定(GUARDRAILS.md §8.1・bindings/catalog.md ts-react-crx@1)
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    // .claude/skills/ はベンダーコピー(手で編集しない・CLAUDE.md参照)、upstream/ は
    // submodule(別リポジトリの内容)なので、どちらも本プロジェクトのlint対象外とする。
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "**/.pytest_cache/**",
      ".claude/skills/**",
      "upstream/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, chrome: "readonly" },
    },
    rules: {
      "no-console": "error",
      "no-empty": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // ログの単一出口(GUARDRAILS.md §8.2)のみ console 呼び出しを許可する
    files: ["src/lib/runtime/log.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["e2e/**/*.ts", "**/*.test.ts", "**/*.test.tsx"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // scripts/*.mjs はNode CLIツール。chromeはPlaywrightのevaluate()コールバック内で
    // ブラウザ側のコンテキストとして参照するため許可する(no-console: この層はキットの
    // 出力契約に相当するため許可 — post_edit_lint.pyのLOG_EXIT_PREFIXESと同じ整理)。
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, chrome: "readonly" } },
    rules: { "no-console": "off" },
  },
);
