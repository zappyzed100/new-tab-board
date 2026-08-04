// vite.config.ts — 新しいタブページ(index.html)・background service worker・
// 予定前アラーム用offscreenドキュメントのビルド設定
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// KaTeXの字句解析器を壊すバンドラのサロゲート潰しを、入力段で無害化するプラグイン(2026-07-23)。
//
// katex/dist/katex.js は正規表現の材料として「単独サロゲート」のエスケープを文字列に持つ
// (`"\\\\[^\uD800-\uDFFF]"` と `"|[\uD800-\uDBFF][\uDC00-\uDFFF]"` の2箇所)。バンドラはこれを
// 実文字へ解釈してから出力を**UTF-8で書く**ため、UTF-8で表現できない単独サロゲートが U+FFFD へ
// 潰れる。結果、KaTeXのtokenRegexの文字クラスが壊れて `\frac` が `\f`+`rac` に分解され、数式が
// 赤いエラー表示になる(実機で発生。minify無効でも同じ=出力段では既に情報が失われており
// renderChunkでは直せない)。
//
// これらの文字列は `new RegExp(...)` にしか渡らないので、JS文字列のエスケープ(`\uD800` 1文字)を
// **正規表現パターン内のエスケープ**(バックスラッシュ+`uD800` の6文字)へ書き換えれば、意味は
// 同一のままバンドラに解釈されなくなる。katex以外へは触らない。
const KATEX_DIST = /katex[\\/]dist[\\/]katex\.js$/;
const SURROGATE_ESCAPE = /\\u(D[89ABab][0-9A-Fa-f]{2}|D[C-Fc-f][0-9A-Fa-f]{2})/g;

function keepKatexSurrogatesEscaped() {
  return {
    name: "keep-katex-surrogates-escaped",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!KATEX_DIST.test(id.split("?")[0])) return null;
      const patched = code.replace(SURROGATE_ESCAPE, "\\\\u$1");
      return patched === code ? null : { code: patched, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), keepKatexSurrogatesEscaped()],
  build: {
    // modulepreload を出さない(2026-08-04)。拡張機能のページはローカルの拡張リソースを読むため
    // preload の先読み効果がほぼ無い一方、Chrome は chrome-extension:// のページで preload エントリを
    // 実際のモジュール取得へマッチできず(「cross-world extension resource mismatch」)、
    // 「preloaded but not used」の警告をロードのたびにコンソールへ出していた(ユーザー報告)。
    // 無効化すると <link rel="modulepreload"> と polyfill チャンクの生成そのものが消える——
    // モジュールは main.js の静的 import としてこれまでどおり読み込まれる(取得回数も変わらない)。
    modulePreload: false,
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
