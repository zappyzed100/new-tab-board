# stack.md — 技術選定理由

## 何を作るか
Chrome の「新しいタブ」ページを、カラム・カードのボード（Todo/Kanban 風）に置き換える
Manifest V3 拡張機能。バックエンドは持たない——保存先はブラウザローカルの
`chrome.storage.local` のみ。

## なぜ TypeScript + React + Vite か
- **TypeScript**: `chrome.*` の型定義（`@types/chrome`）が充実しており、ストレージ形状の
  誤りをビルド時に検出できる。ボードのデータモデル（カラム/カード）を型で固定できる。
- **React**: カラム/カードの追加・削除・並び替えは典型的な木構造の状態更新——宣言的UIの
  恩恵が大きい。新しいタブという毎回開かれるページなので、初期表示速度も気にする必要は
  あるが、ボード程度の規模なら React で問題にならない。
- **Vite**: ネイティブ ESM ベースで起動・再ビルドが速い（G11 ループ秒速）。拡張機能特有の
  複雑なマルチエントリ構成が不要（新しいタブ用の `index.html` 1枚のみ）なので、専用の
  crx 系プラグインを追加せず素の Vite 設定で足りると判断した（依存を増やさない —
  「タスクが要求する以上の抽象化を持ち込まない」の実践）。

## なぜバックエンドを持たないか
新しいタブのボードは個人利用のローカルデータで完結する機能であり、同期が要るとしても
将来 `chrome.storage.sync` へ切り替えれば済む（シームは `src/lib/storage.ts` の1箇所に
閉じてある）。外部サーバーを持たないことで、外部I/Oの検疫（G8）・秘匿管理（§8.3）の
対象がゼロになり、テストの非決定性の主要因（ネットワーク）も最初から存在しない。

## E2E に Playwright の persistent context を使う理由
Chrome 拡張機能は通常の `page.goto()` では検証できない——`chrome.storage` 等の拡張API は
実際に読み込まれた拡張機能のコンテキスト内でしか使えない。そのため
`chromium.launchPersistentContext` に `--load-extension` / `--disable-extensions-except`
を渡し、ビルド済みの `dist/` を実際に読み込んだ状態で新しいタブページを開いて検証する
（`e2e/fixtures.ts`）。拡張機能の読み込みは headless モードでは安定して動作しないため、
E2E は headed 実行が前提（CI では `xvfb-run` を使う）。

日常的な UI 操作（Playwright MCP による操作レール）は、この特別な起動が不要な
`npm run dev`（Vite dev server）に対して行う——`src/lib/storage.ts` が `chrome.*` 不在時に
`localStorage` へフォールバックするため、普通の Web ページとして同じ UI を操作できる。
