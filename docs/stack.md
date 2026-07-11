# stack.md — 技術選定理由

## 何を作るか
Chrome の「新しいタブ」ページを、個人用ダッシュボード(ブックマークグリッド・複数ノートの
Markdownエディタ・履歴/diff/全文検索・小型カレンダー等)に置き換える
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

## なぜ手書きCSSから Radix Themes (+ radix-ui) へ移行したか (2026-07-11)
当初は「最小依存・自前実装優先」の方針でUI一式を手書きReact+手書きCSS(`styles.css`)
だけで組んでいた(このセクションの上の理由群は全てその前提で書かれている)。
ユーザーの明示的な指示により、UI層全体を`@radix-ui/themes`へ移行した——
既存のカスタムCSS/デザイントークン(`:root`の色・間隔・シャドウ等)は結果的に
1つも未使用にならず、全24種のトークンが移行後も引き続き参照されている
(削除できたのはNoteTabsの曲線シェイプ専用CSSのみ)。実際には次のハイブリッド
構成に落ち着いた:
- **Radixにそのまま置き換えた部分**: 汎用ボタン/入力/チェックボックス
  (`Button`/`IconButton`/`TextField`/`Checkbox`等)、モーダル(`Dialog`)、
  セレクトボックス(`Select`)、ノートタブ(`Tabs`)。
- **Radixのトークン/コンポーネントの上に自前CSSを重ねた部分**: ブックマーク
  グリッドのD&D並べ替え(Radixに代替コンポーネントが無い)。小型カレンダーの
  月グリッドは2026-07にRadix Themes止まりの自前実装から`react-day-picker`
  (OSS。後述)へさらに置き換えた。
- **既知の副作用として許容/対応したもの**: `ThemeToggle`のネイティブ`<select>`
  → `Select`化に伴うE2E操作のクリックベース化。`ShortcutsModal`のoverlay
  クリック検証を`data-testid`から`.rt-DialogOverlay`クラスセレクタへ変更
  (`Dialog.Content`がoverlay要素を内部にカプセル化しテスト用属性を渡せないため)。
- **`@radix-ui/themes`ではなく生の`radix-ui`(themesが内部で使う下層primitive)を
  直接使った箇所**: `NoteTabs.tsx`のみ。`@radix-ui/themes`の`Tabs.Trigger`は
  子要素を可視用+隠しレイアウト計測用の2箇所に複製する内部実装のため、
  `data-testid`付きの子(閉じるボタン等)を渡すとDOM上に同じtestidの要素が
  2つできてE2Eのクリック操作が不安定になる実害があった。生の`radix-ui`
  パッケージなら`Tabs.Trigger asChild`で複製を避けられるため、この1ファイルだけ
  依存を使い分けている(`依存追加: radix-ui`のコミット参照)。

## なぜ小型カレンダーをreact-day-pickerへ、日付フォーマットをdate-fnsへ移行したか (2026-07-12)
ユーザーの明示的な指示(「自作じゃなくてOSSから取ってきて」)により、自前の月グリッド
構築ロジック(`buildMonthGrid`)を撤去し`react-day-picker`(date-fns作者による定番ライブラリ)
へ置き換えた。GCal連携(URLを組み立てて新しいタブで開くだけ)は引き続き自前の純関数
(`buildGCalUrl`)のまま——react-day-pickerの責務は月グリッドの描画とキーボード操作性
(WCAG準拠)だけに絞っている。前月/翌月ボタン・月ラベルは`components`オーバーライドで
Radixの見た目+既存の`data-testid`を保っている(`hideNavigation`で隠して別途自前で
並べると見出しが二重に出てしまうため)。

時計(`Clock.tsx`)は現状維持を選んだ——調査の結果、まともにメンテされている
「デジタル時計表示」OSSライブラリが見当たらなかった(唯一の候補`react-live-clock`は
`moment.js`という非推奨の重い依存を持ち、リポジトリ自体もNode 7/Bower前提で
事実上放置されている)ため、無理に採用すると悪化するだけと判断した。ただし
日付/時刻の**フォーマット**部分(`clockFormat.ts`)はdate-fnsに置き換えている
(react-day-pickerが依存に持つため実質コスト無し)。あわせて、自前の
`setInterval(fn, 1000)`は実行遅延やバックグラウンドタブでのスロットリングで
表示がズレる/止まって見える実害があったため、秒表示自体を廃止(分表示のみに変更)し、
毎回「次の分境界」までの残り時間を実時刻から再計算してsetTimeoutし直す自己補正方式
(`msUntilNextInterval`)に変更した。

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
