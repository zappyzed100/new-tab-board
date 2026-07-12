# plan.md — 設計根拠

## native-host/ (NASブリッジ native messaging host・2026-07-12)
NASフォルダへの書き込みは`showDirectoryPicker()`を使っていたが、Chrome拡張機能の
ページから呼ぶと選択後もAbortErrorになる既知バグ(WICG/file-system-access#314、
crbug.com/issues/40240444)が実機で再現し続け、エラーメッセージ表示以上の対応が
できなかった(ユーザー指示により本格対応)。拡張機能はサンドボックスの都合上
任意のファイルパスを直接読み書きできないため、Native Messaging(PC側に常駐する
別プログラムと標準入出力でJSON通信する)以外に確実な方法が無い。

Flow Launcher連携(`docs/native-messaging-protocol.md`)は「host本体は別リポジトリで
実装する」設計だったが、あちらは既存の第三者ツール(Flow Launcherのフォーク)を
統合する話であるのに対し、こちらは本アプリ専用の自作ブリッジのため、本リポジトリ
直下に`native-host/`として同梱する(Google公式のnative messaging Pythonサンプルを
下敷きにした最小実装。外部ライブラリへの依存追加はしていない)。契約は
`docs/nas-native-messaging-protocol.md`に記載。拡張側クライアントは
`src/lib/externalIO/nasNativeHost.ts`。

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

## src/lib/gemini/ (Gemini連携の土台・2026-07-12)
ノートの自動タグ付け・要約・TODO抽出(ユーザー要望)は、いずれもGoogle Gemini APIの
`generateContent`を呼ぶ共通の土台を必要とする。drive/(Google Drive)と同じく「特定の
外部サービス連携」という独立した関心事なので、`src/lib/`直下に専用ディレクトリ
`src/lib/gemini/`を新設した(seamは`gemini.ts`の`callGemini`一本。fetchを依存注入で
差し替えテスト可能)。APIキーは秘匿情報のため、syncにもDriveの全データJSONバックアップにも
乗らないIndexedDBの設定ストア(db.tsの`getGeminiApiKey`/`setGeminiApiKey`)へ保存する。
無料枠に収まりやすいflashモデル(gemini-2.0-flash)を既定にする。

## タグ検索: Markdown+front matter正本 + SQLite再生成インデックス (2026-07-12)
ユーザー設計を採用。正本はNAS上の「1ノート=1つの .md + YAML front matter」
(id/title/tags/created_at/updated_at、AI要約は source_note_id/generated_by)。
書き出しはnative-host(nas_bridge.py)経由。**ブラウザ拡張からSQLiteは直接使えない**ため、
アプリ内のタグ検索はメモリ内フィルタ＋既存IndexedDB(search.ts)で行う(ノートは最大501件・
全件メモリ上なので索引不要で一瞬)。「外部ツールでSQL検索したい」用途のため、native-host側に
Python(標準ライブラリのsqlite3のみ)で notes/*.md → data/index.db を再生成するツール
(build_index.py)を別途置く。index.dbは消えても.mdから再生成できる(正本は.md)。
front matterのパースは形式を自前で制御しているため最小の自前パーサで済ませPyYAML依存は持たない。
