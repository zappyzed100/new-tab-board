# New Tab Board

Chrome の新しいタブページを、個人用ダッシュボードに置き換える Manifest V3 拡張機能。
ブックマークグリッド・複数ノートのMarkdownエディタ(履歴/diff/全文検索/wikiリンク付き)・
コマンドパレット・小型カレンダー・JSON入出力などをまとめて提供する。外部認証・外部APIは
一切使わない「ローカル完結」構成——保存先はブラウザローカルの `chrome.storage`(sync/local)
と IndexedDB のみ(バックエンド無し)。技術選定の理由は [docs/stack.md](docs/stack.md) を参照。
機能の詳細仕様は `SPEC.md` を参照。

## セットアップ

```sh
npm ci
uv tool install pre-commit   # 初回のみ
pre-commit install           # 初回のみ
```

## よく使う操作

このプロジェクトは共通動詞ルーター経由で操作する（規約: [AGENTS.md](AGENTS.md) §0）:

```sh
uv run scripts/dev.py up      # dist/ を継続ビルド(vite build --watch)
uv run scripts/dev.py test    # 単体テスト(vitest)
uv run scripts/dev.py e2e     # E2E(拡張機能を実際に読み込んだPlaywright)
uv run scripts/dev.py check   # 構造検査
uv run scripts/dev.py verbs   # 動詞一覧と配線状態
```

## Chrome へ読み込む

1. `npm run build` で `dist/` を生成する。
2. `chrome://extensions` を開き、デベロッパーモードを有効化する。
3. 「パッケージ化されていない拡張機能を読み込む」で `dist/` を選択する。
4. 新しいタブを開くとダッシュボードが表示される。

## 主な機能

- **ブックマークグリッド**: 追加/編集/削除・D&D並べ替え・数字キー1-9ジャンプ。
- **複数ノート(CodeMirror 6)**: Markdownプレビュー・`#タグ`・`[[wikiリンク]]`+バックリンク・
  インライン電卓(`3 * 8 =` → 結果を自動追記)。検索はノート編集エリア内のトグル(Cmd/Ctrl+F)。
- **履歴/diff**: 編集の切れ目(アイドル/blur/paste等)を自動検出してIndexedDBへgzip保存。
  diff表示・復元(復元前に現在値もスナップショット)。
- **全文検索**: 自前の転置インデックス(形態素解析なし・分かち書き言語向けの近似)。
- **クイックオープン(Cmd/Ctrl+K)**: ノート切替・ブックマーク遷移・アプリ起動・
  ファイルを開くを1つの入口に統合。ショートカットは単一レジストリ駆動(`?`でチートシート)。
- **JSON入出力+ローカルファイル**: 全データのJSON書き出し/取り込み、File System Access
  経由での.txt読み込み・全ノートのフォルダ一括書き出し。
- **時計/テーマ(light/dark/auto)+小型カレンダー+単体TODOリスト**: サイドバーに常時表示の
  小型ウィジェット。カレンダーは日クリックでGoogleカレンダーへURL遷移(API/OAuth不要・一方向)。
  TODOリストはノート本文とは独立したシンプルな追加/完了/削除のみ(TodoMVC相当)。
- **Google Drive自動同期**: ノート現行内容のみを上書きミラー(履歴は上げない)。
- **Google Calendar読み取り+次の予定カウントダウン**: 数分おきのポーリング+
  ローカルティックで最上部に大きく表示。
- **予定前アラーム**: 予定の10分前から、停止するまで鳴り続ける(Chrome起動中のみ)。
- **SSD→NAS二層アーカイブ**: IndexedDB(SSD一次退避)からNASフォルダへ履歴本体を
  store-and-forward。
- **Flow Launcher連携(拡張側クライアントのみ)**: host本体は別リポジトリで実装
  (通信規約は`docs/native-messaging-protocol.md`)。

外部連携機能(Drive/Calendar/アラーム/NAS/Flow Launcher)は自動テストで検証できない
実機確認項目を伴う。チェックリストは[docs/manual-verification.md](docs/manual-verification.md)
を参照。

## リポジトリの構成

- `src/newtab/` — 新しいタブページの React UI(`components/` に機能別コンポーネント)
- `src/lib/` — ストレージ・IndexedDB・ログ・時刻などの外部I/Oシーム（UIから直接叩かない —
  AGENTS.md §5）。全文検索・電卓・wikiリンクパーサ等の純粋ロジックもここに置く。
- `e2e/` — Playwright E2E（拡張機能を実際にロードして検証）
- `SPEC.md` — 機能仕様の正本
- `docs/stack.md` — 技術選定理由
- `docs/native-messaging-protocol.md` — Flow Launcher連携の通信規約(host側実装の契約)
- `docs/manual-verification.md` — 自動テストで検証できない実機確認チェックリスト
- `docs/guardrails/` — `GUARDRAILS.md` / `GOALS.md` / `BOOTSTRAP.md` / `CUSTOMIZE.md`。
  `bindings/catalog.md` / `AGENTS.md`（ルート）とあわせて、このリポジトリの出戻り防止機構
  （LLMエージェントとの協業ガードレール）の正本。作業前に読むこと。
