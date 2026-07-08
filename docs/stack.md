# stack.md — 技術選定理由

## 何を作るか
Chrome の「新しいタブ」ページを、個人用ダッシュボード(ブックマークグリッド・複数ノートの
Markdownエディタ・履歴/diff/全文検索・コマンドパレット・小型カレンダー等)に置き換える
Manifest V3 拡張機能。外部認証・外部APIは一切使わない「ローカル完結」構成——保存先は
ブラウザローカルの `chrome.storage`(sync/local)と IndexedDB のみ(バックエンド無し)。
詳細な機能仕様は `SPEC.md` を参照。

## なぜ TypeScript + React + Vite か
- **TypeScript**: `chrome.*` の型定義（`@types/chrome`）が充実しており、ストレージ形状の
  誤りをビルド時に検出できる。ノート/ブックマーク/スナップショット等のデータモデルを
  型で固定できる。
- **React**: ノートタブ切替・ブックマークのD&D並べ替え・パネルの開閉等、状態更新の種類が
  多岐に渡る——宣言的UIの恩恵が大きい。新しいタブという毎回開かれるページなので初期表示
  速度も重要だが、`React.lazy`+`Suspense`でCodeMirror/markdown-it等の重い依存を動的import
  へ分割し、初期バンドルを軽く保っている(SPEC.md §8)。
- **Vite**: ネイティブ ESM ベースで起動・再ビルドが速い（G11 ループ秒速）。拡張機能特有の
  複雑なマルチエントリ構成が不要（新しいタブ用の `index.html` + background service worker
  の2エントリのみ）なので、専用の crx 系プラグインを追加せず素の Vite 設定で足りると
  判断した（依存を増やさない — 「タスクが要求する以上の抽象化を持ち込まない」の実践）。

## なぜバックエンドを持たないか
このダッシュボードは個人利用のローカルデータで完結する機能であり、同期が要るとしても
`chrome.storage.sync`(ブックマーク/設定)へは既に対応済みで、ノート本体は容量の都合上
`chrome.storage.local`+IndexedDB(スナップショット履歴)に置いている。シームは
`src/lib/storage.ts`・`src/lib/db.ts` の2箇所に閉じてある。外部サーバーを持たないことで、
外部I/Oの検疫（G8）・秘匿管理（§8.3）の対象がゼロになり、テストの非決定性の主要因
（ネットワーク）も最初から存在しない。Google Drive自動同期・Google Calendar API等は
OAuth/外部通信が必須になるため意図的にv1スコープ外とした（`SPEC.md` 参照）。

## なぜ履歴をIndexedDB+gzipで持つか
編集の切れ目ごとにノート全文のスナップショットを取る設計(差分ではなく毎回全文)のため、
`chrome.storage.local`の10MBクォータでは長期運用で不足する。IndexedDBは同一オリジンで
実質無制限に近い容量を扱え、拡張機能内で完結する(追加の権限やネイティブ依存が不要)。
圧縮はChrome標準の`CompressionStream`/`DecompressionStream`(追加依存なし)を使い、
base64文字列として保存する。差分表示(diff)は保存時ではなく表示時に`diff-match-patch`で
都度算出する——保存フォーマットを「常に全文」に保つことで、復元ロジックがシンプルになる。

## なぜCodeMirror 6か
軽量なMarkdown編集に十分な機能(構文ハイライト・undo履歴)を持ちつつ、Reactの状態と
双方向同期する複雑さを避けるため、ノート切替時は`key={noteId}`でコンポーネントごと
再マウントする設計を採用した(EditorStateとReact state両方が「真実の源」になる問題を
そもそも発生させない)。

## なぜ全文検索・電卓・wikiリンクパーサを自前実装するか
いずれも要件が小さく閉じており(転置インデックス・再帰下降パーサ・正規表現リンク抽出)、
外部ライブラリを追加するコストの方が大きいと判断した。電卓は`eval`/`Function`を使わない
安全な実装が必須要件のため、なおさら自前が適切。全文検索は分かち書きの無い日本語の
形態素解析まではスコープに含めない(既知の限界としてコード内に明記)。

## E2E に Playwright の persistent context を使う理由
Chrome 拡張機能は通常の `page.goto()` では検証できない——`chrome.storage` 等の拡張API は
実際に読み込まれた拡張機能のコンテキスト内でしか使えない。そのため
`chromium.launchPersistentContext` に `--load-extension` / `--disable-extensions-except`
を渡し、ビルド済みの `dist/` を実際に読み込んだ状態で新しいタブページを開いて検証する
（`e2e/fixtures.ts`）。拡張機能の読み込みは headless モードでは安定して動作しないため、
E2E は headed 実行が前提（CI では `xvfb-run` を使う）。

日常的な UI 操作（Playwright MCP による操作レール）は、この特別な起動が不要な
`npm run dev`（Vite dev server）に対して行う——`src/lib/storage.ts` が `chrome.*` 不在時に
`localStorage` へフォールバックするため、普通の Web ページとして同じ UI を操作できる
(IndexedDBはブラウザ標準APIのため`npm run dev`でもそのまま動く)。
