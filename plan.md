# plan.md — 設計根拠

## src/background/ (Step 8b・2026-07-08)
E2Eテストが拡張機能IDを解決するには service worker の存在が必要(Manifest V3では
`context.serviceWorkers()` / `waitForEvent("serviceworker")` でIDを取得する)。
本アプリは新しいタブ上書きのみで機能的にはbackgroundを必要としないが、E2E観察の
ためだけに最小限のno-opに近いservice worker(`background.ts`)を追加した
(インストール時に`logOp`で1行ログを出す以外は何もしない)。
