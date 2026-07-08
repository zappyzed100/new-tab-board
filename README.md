# New Tab Board

Chrome の新しいタブページを、カラム/カードのボード(Todo/Doing/Done)に置き換える
Manifest V3 拡張機能。保存先はブラウザローカルの `chrome.storage.local` のみ
（バックエンド無し）。技術選定の理由は [docs/stack.md](docs/stack.md) を参照。

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
4. 新しいタブを開くとボードが表示される。

## リポジトリの構成

- `src/newtab/` — 新しいタブページの React UI
- `src/lib/` — ストレージ・ログ・時刻などの外部I/Oシーム（UIから直接叩かない — AGENTS.md §5）
- `e2e/` — Playwright E2E（拡張機能を実際にロードして検証）
- `docs/stack.md` — 技術選定理由
- `docs/guardrails/` — `GUARDRAILS.md` / `GOALS.md` / `BOOTSTRAP.md` / `CUSTOMIZE.md`。
  `bindings/catalog.md` / `AGENTS.md`（ルート）とあわせて、このリポジトリの出戻り防止機構
  （LLMエージェントとの協業ガードレール）の正本。作業前に読むこと。
