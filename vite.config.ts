// vite.config.ts — 新しいタブページ(index.html)・background service worker・
// 予定前アラーム用offscreenドキュメントのビルド設定
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        background: fileURLToPath(new URL("src/background/background.ts", import.meta.url)),
        offscreen: fileURLToPath(new URL("offscreen.html", import.meta.url)),
      },
      output: {
        // 拡張機能はハッシュ無しの安定したファイル名を期待するため無効化する
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
