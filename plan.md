# plan.md — 設計根拠

## UI層をRadix Themesへ全面移行 (2026-07-11)
「最小依存・自前実装優先」の方針(docs/stack.md)から転換し、`@radix-ui/themes`を
UIコンポーネントの標準として全面採用した(ユーザー指示)。詳細な根拠・ハイブリッド
構成(Radixに置き換えた部分/自前CSSを残した部分/生radix-uiを使った1ファイル)は
docs/stack.mdの該当節を参照。新規ディレクトリは作っていない(既存コンポーネント
ファイルの内部実装差し替えのみ)。

## src/offscreen/ (M12・2026-07-11)
予定前アラーム(SPEC.md §4.11)はMV3のservice workerが音声を再生できないため、
`chrome.offscreen`(reason: AUDIO_PLAYBACK)でオフスクリーンドキュメントを作り、
その中の`<audio loop>`でループ再生する。newtab/lib一方向のレイヤーとは別に
「拡張機能が生成する隠しページ」という第三のエントリポイントが必要なため、
`src/newtab/`と並ぶ`src/offscreen/`として新設した(background.tsと同じ思想で、
vite.config.tsに専用ビルドエントリを追加する)。

## src/background/ (Step 8b・2026-07-08)
E2Eテストが拡張機能IDを解決するには service worker の存在が必要(Manifest V3では
`context.serviceWorkers()` / `waitForEvent("serviceworker")` でIDを取得する)。
本アプリは新しいタブ上書きのみで機能的にはbackgroundを必要としないが、E2E観察の
ためだけに最小限のno-opに近いservice worker(`background.ts`)を追加した
(インストール時に`logOp`で1行ログを出す以外は何もしない)。
