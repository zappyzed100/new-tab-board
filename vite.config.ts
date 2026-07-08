// vite.config.ts — 新しいタブページ(index.html)とbackground service workerのビルド設定
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
