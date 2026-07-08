# catalog.md — 検証済みバインディング列のカタログ（GUARDRAILS.md §12.7 の正本）

> **このファイルの役割**: 言語・スタックごとの「検証済みの穴埋め値」を列として蓄積する場所。
> 契約（GUARDRAILS.md §1〜§9・§12）は言語なし、**具象値はすべてここ**。
> 新規リポジトリのブートストラップ（§11）は「列を選ぶ → paste-block を所定の場所へ貼る →
> 全対象ファイルに `BINDING-SOURCE: 列ID@版` を刻印する」だけになる（G13: 移植の定数時間）。
>
> **検証状態の定義**:
> - **実測済み** = そのプロジェクトで違反注入込みのDoDを通過した値（列末尾に実測元を記録）。
> - **要実測** = 標準的な値だが、初回採用リポジトリの Step で成功系と違反注入の両方を
>   実測してから「実測済み」へ昇格させる（完了=実行結果 — §10 実行規律）。
> - 値を修正したら版を上げる（`@1` → `@2`）。**列の値を採用先で黙って変えない**——
>   変えたくなったら新しい版としてここに戻す（G5: 単一の正）。
>
> **新しい列の起こし方**: 下のスキーマ表の全行を埋める（空欄不可・「該当なし」は可）。
> 例の値のコピペで埋めた気になるのは禁止（§11 Step 0 と同じ規律）。

## スキーマ（列が埋めるべき行の一覧）

| 区分 | 行 |
|---|---|
| 静的（表A） | 整形（冪等）／**編集直後 lint（単一ファイル・3秒予算の判定系 — §1 第2段。収まらない言語は「該当なし（push 段で回収）」と明記）**／静的解析／lint昇格（print系・空catch を error化）／テスト／print系直呼びパターン／ログ単一出口の置き場所／公開シンボル抽出／import・参照抽出／テスト内 sleep・非決定・**外部I/O** パターン／**非推奨・世代交代パターン（deprecated-api — §3.3・v2.6。下の出典規律に従う）**／テストファイル判別／**単一テストファイル実行（red-first — §5・v2.7。`SINGLE_TEST_COMMAND`・実行位置が下層なら `SINGLE_TEST_CWD`。単独実行が構造的に不能な言語は「該当なし＋代替」を判断ごと記録）**／**依存マニフェスト（ファイル名＋依存セクション — §3.4 検査4。既定4種は `repo_scan.py` の `DEPENDENCY_MANIFESTS` に同梱済み＝列は確認のみ、独自エコシステムなら加算追記）**／**設計根拠の対象レイヤー（feat-without-plan — §3.4 検査5。v2.6 soft 導入・v2.8 hard 昇格＝G14。`PLAN_LAYER_ROOTS`）**／**ログ境界パターン＋ログ呼び出しパターン（missing-log-coverage — §8.4・v2.19 soft 導入。`LOG_BOUNDARY_PATTERNS`／`LOG_CALL_PATTERN`。下の出典規律に従う）**／生成物パターン／ヘッダー書式（共通: `<ファイル名> — 役割`） |
| ランタイム（表D — §12） | `up`／`reset`（seed込み）／`seed`／`time`（時刻注入）／`db`（DB読み）／`e2e`／操作レール（実UI操作の手段）／観察レール（コンソール・ネットワーク・ログの読み方）／UIテストID検査（`ui-missing-testid`）／外部I/Oシームの置き場所 |
| paste-block | `scripts/repo_scan.py` BINDING／`scripts/dev.py` COMMANDS／`post_edit_format.py` DISPATCH／**`post_edit_lint.py` DISPATCH（v2.5導入・v2.24でPython化）**／pre-push フック群／CI ジョブ群（E2E含む）／`.mcp.json`（操作レールがMCPの列のみ） |

### 「非推奨・世代交代パターン」の出典規律（v2.6 — §3.3 deprecated-api の列を埋める時の正本）

列値に採ってよい出典の優先順位:
1. **ベンダー公式の AI プロンプト**（例: Supabase の「MUST NOT generate」リスト）
2. **公式の非推奨告知**（例: Python 3.12 の `datetime.utcnow` 非推奨）
3. コミュニティ由来（.mdc 集等）——**①②のみ初期値に採り、③は採用先での実測後に還元**する。

**正規表現で近似できない構文世代**（例: Next.js 15 の await params のような構文レベルの
移行）**は列に入れない**——偽陽性 > 価値（§7.4「近似は仕様」の範囲を超えるものは対象外）。
各パターンのラベルには**代替 API を必ず書く**（違反者がラベルだけで直せる形 — G4）。

### 関数複雑度ゲートの対応表（v2.18 — 調査④。Step 6 の lint 昇格時に有効化を推奨）

自作の AST / 正規表現複雑度検査は**不採用**（linter のネイティブ規則が上位互換——採用
ゲート1条）。各列の linter で以下を有効化する（閾値は列の実測で調整・ここは対応表の正本）:

| 列 | サイクロマティック複雑度 | ネスト/引数/長さ |
|---|---|---|
| ts-react-web | eslint `complexity` | `max-depth`・`max-params`・`max-lines-per-function` |
| python-uv | ruff `C901`（mccabe） | `PLR0912`（分岐）・`PLR0913`（引数）・`PLR0915`（文数） |
| rust | clippy `cognitive_complexity`（nursery——安定化まで任意） | `clippy::too_many_arguments`・`clippy::too_many_lines` |
| dart-flutter | `dart_code_metrics` の cyclomatic-complexity 等（サードパーティ——採用時は列の版上げで記録） | 同左 maximum-nesting-level 等 |

### post_edit フックの速度3原則（v2.24 — `DISPATCH` を列で埋める時の正本）

`post_edit_format.py`/`post_edit_lint.py` は編集の度に発火するホットパス。フック本体を
どの言語で書くかより、**ここに書くコマンドが何を呼ぶか**の方が体感速度への影響が大きい
（実測: `npx prettier` はローカルinstall済みでも約900ms/回、直接呼び出しなら約240ms/回
——差の680msはnpx自身の解決コストで、Node起動コスト約40msの遥か上）。優先順位:

1. **ネイティブ単一バイナリを選ぶ**（Rust/Go製）。Node製ツール（素のESLint/Prettier）は
   毎回Node起動コストが乗る。ruff・biome・rustfmt・dart formatはこの起動税がゼロ。
2. **ラッパー越しに呼ばない**。`npx`/`uvx` はフックのたびに環境解決を走らせる
   （実測差は上記）。`node_modules/.bin/<tool>` や `uv tool install` 後の直接PATH呼び出しを使う。
3. **それでも足りなければ常駐（daemon）化を検討する**（例: Biomeのdaemon/LSP）。
   1ファイルだと実際の処理よりプロセス起動そのものが支配的になるため、何千回もの
   起動コストを常駐プロセスで償却する——ただしキット側では未実装（列採用時の判断）。

フックの言語（Python固定）と、フックが呼ぶformat/lintツールの言語は独立——TSを触るなら
Biome、Goを触るならgofmtを、Pythonフックから普通に呼べばよい。

### ログ境界パターンの出典規律（v2.19 — §8.4 missing-log-coverage の `LOG_BOUNDARY_PATTERNS`／`LOG_CALL_PATTERN` を列で埋める時の正本）

対象は「重要な処理」ではなく**客観的に検出できる境界**のみ（判断は §8.4 参照）:
1. **I/O・外部呼び出し**（HTTPクライアント呼び出し・DBクエリ・ファイル書き込み等の
   API呼び出しパターン）。
2. **エラーハンドラ**（`catch` / `except` 節の開始行——`empty_catches` lint（§8.1）が
   拾わない「非空だがログしていない」catchを補う）。
3. `LOG_CALL_PATTERN` は列の `logOp` 相当（単一出口）の呼び出しパターン1本のみ。

正規表現で近似できない構文（動的ディスパッチ越しのI/O等）は列に入れない（§7.4「近似は
仕様」の範囲を超えるものは対象外——偽陽性 > 価値）。初回充填は soft 運用のまま数タスク
実測し、偽陽性率を確認してから対象パターンを広げる（`feat-without-test` と同じ経路）。

### MCP・エコシステム採用規律（v2.11 — **2026-07-07 調査**の判定。§3.3 `mcp-not-allowed` の許可リスト `MCP_ALLOWED_SERVERS` を増やす時の正本）

採用は次の**ゲート3条をすべて**通し、判定（不採用も）を本注記か §10 に記録してから:
1. **重複排除（G5/G2）**: ネイティブツール・汎用 CLI（例: GitHub は `gh`）・キットの既存
   機構（dev.py 動詞・STRUCTURE.md・§12 レール）で同役が果たせるなら不採用。逆転条件は
   「**実測で**明らかに性能が大きい」のみ（伝聞・宣伝は根拠にしない——完了=実行結果）。
2. **常駐予算（G3）**: ツール定義は接続だけでコンテキストを消費する（実測例: GitHub MCP
   フル 93 ツール ≈ 42〜55k トークン。Tool Search 既定有効でも出力・誤選択・管理の
   コストは残る）。スポット用途は `.mcp.json` に入れず **タスク単位の
   `claude mcp add/remove`** に格下げする（常駐させない判断も記録する）。
3. **契約整合（G7/G5/§13）**: 書込可能ツールは門（§2/§3）の外の変更経路——原則不採用か
   read-only 限定。メモリファイルを生やすものは §13「中央メモ禁止」と衝突。外部内容を
   読み込むものは注入面（例: GitHub MCP の toxic agent flow 実証 2025-05）を判定に含める。

**現在の採用状態（2026-07-07）**: 常駐は **Playwright MCP のみ**（Web 列の操作レール
§12.4——本ファイル ts-react-web 列の `.mcp.json` paste-block が実体）。保留4件
（Chrome DevTools MCP・Context7・Serena・Skills 化）はトリガー付きで GUARDRAILS.md §10
保留節、不採用の判定表は README v2.11 が転記先。調査の再実施時は本注記の日付を更新する。

---

## 列: ts-react-web@6 — TypeScript + React（Web/PWA・Vite・Supabase想定）【要実測】

> @6（v2.10）: 注釈の参照先を「AGENTS.md §7」へ機械改名（章の移設に追随・コマンド値の変更なし — Phase 22）。
> @5（v2.7）: 「単一テストファイル実行」の1行と paste-block 2箇所（repo_scan・red-first ジョブ BINDING）を追加。
> @4（v2.6）: 「非推奨・世代交代パターン」「設計根拠の対象レイヤー」の2行と paste-block の追記（値の変更＝版上げ — 本書運用ルール）。
> @3（v2.5）: 「編集直後 lint」「依存マニフェスト」の2行と `post_edit_lint.sh` paste-block を追加。

前提ツール: Node.js（npm/npx）・Supabase CLI（ローカルDB使う場合）・Playwright。

| 行 | 値 |
|---|---|
| 整形（冪等） | `npx prettier --write <file>` |
| 編集直後 lint | `npx --no-install eslint --max-warnings=0 <file>`（rc=1 のみブロック。下の paste-block） |
| 静的解析 | `npx tsc --noEmit` ＋ `npx eslint .` |
| lint昇格 | eslint: `no-console: error`（`src/lib/log.ts` のみ off）・`no-empty: error` |
| テスト | `npx vitest run` |
| E2E | `npx playwright test` |
| print系直呼び | `console.log(` `console.info(` `console.debug(`（出口: `src/lib/log.ts`） |
| ログ単一出口 | `src/lib/log.ts` の `logOp(tag, op, detail, {error, elapsedMs})`（形式は AGENTS.md §7） |
| テスト内 非決定 | `Date.now(` ・ `new Date()`（引数なし）・ `Math.random(`（Clock/seed注入で代替） |
| テスト内 外部I/O | `fetch(` `axios` `XMLHttpRequest`（フェイク/記録済みフィクスチャを注入） |
| 非推奨・世代交代パターン | `@supabase/auth-helpers-nextjs` の import（公式非推奨——`@supabase/ssr` へ移行。Supabase 公式 AI プロンプトの生成禁止指定＝出典①②）。**サーバー側 `getSession(`→`getUser()` は本列では対象外**——本列はブラウザ SPA で、クライアントの `getSession()` は正規 API のため偽陽性>価値（Phase 15 の基準。SSR / Edge Functions を持つ列を起こす時にそちらへ載せる——判断ごと記録） |
| テスト判別 | `\.test\.tsx?$` ・ `^e2e/.*\.spec\.ts$`（**E2E specを含める＝fix⇔テスト対の対象 — G10**） |
| 単一テストファイル実行 | `npx vitest run {file}`（cwd=ルート。E2E spec（playwright）が対象になった場合は vitest 上で実行エラー＝赤側に倒れる——近似は仕様 §7.4・境界は §5） |
| 依存マニフェスト | `package.json`（dependencies / devDependencies）— 既定表に同梱済み（確認のみ・追記不要） |
| 設計根拠の対象レイヤー | `src`（`PLAN_LAYER_ROOTS`。plan の置き場は既定の `plan.md` / `docs/plans/` — §3.4 検査5） |
| 生成物 | `src/types/supabase.ts` 等の型生成物（`supabase gen types` の出力先） |
| `up` | `supabase start`（または `docker compose up -d`）＋ `npm run dev -- --port 5173` は別端末 |
| `reset` | `supabase db reset`（seed.sql を含む＝reset=seed込み — §12.2） |
| `time` | `.env.local` の `VITE_TIME_FREEZE` を書き換え、アプリは Clock 抽象がこれを読む（§12.2） |
| `db` | `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "{args}"` |
| 操作レール | **Playwright MCP**（実ブラウザ。アクセシビリティスナップショットでUIを読む — §12.4） |
| 観察レール | Playwright MCP のコンソール/ネットワーク読取・`dev.py db`・`supabase logs` |
| UIテストID | 対象 `\.tsx$`・要素 `<(button|a|input|select|textarea|[A-Z]\w*)\b[^>]*on(Click|Submit|Change)=[^>]*>`・属性 `data-testid\s*=` |
| 外部I/Oシーム | `src/lib/api/` 配下に集約（fetch直呼びをUI層に書かない） |

**paste-block（`scripts/repo_scan.py` BINDING へ）**:

```python
CODE_EXTS |= {".ts", ".tsx"}
HEADER_REQUIRED_EXTS |= {".ts", ".tsx"}
TEST_PATH_PATTERNS += [re.compile(p) for p in (r"\.test\.tsx?$", r"^e2e/.*\.spec\.ts$")]
GENERATED_PATTERNS += [re.compile(r"^src/types/supabase\.ts$")]
_TS_SLEEP = [(re.compile(r"\bsetTimeout\s*\(|\bsleep\s*\("), "setTimeout/sleep")]
SLEEP_PATTERNS[".ts"] = _TS_SLEEP; SLEEP_PATTERNS[".tsx"] = _TS_SLEEP
_TS_NONDET = [(re.compile(r"\bDate\.now\s*\("), "Date.now()（Clock抽象で注入する）"),
              (re.compile(r"\bnew Date\s*\(\s*\)"), "引数なし new Date()（固定時刻を渡す）"),
              (re.compile(r"\bMath\.random\s*\("), "Math.random()（seed付き乱数を注入する）")]
NONDETERMINISM_PATTERNS[".ts"] = _TS_NONDET; NONDETERMINISM_PATTERNS[".tsx"] = _TS_NONDET
_TS_NET = [(re.compile(r"\bfetch\s*\(|\baxios\b|\bXMLHttpRequest\b"), "fetch/axios/XHR")]
TEST_NETWORK_PATTERNS[".ts"] = _TS_NET; TEST_NETWORK_PATTERNS[".tsx"] = _TS_NET
_TS_PRINT = [(re.compile(r"\bconsole\.(log|info|debug)\s*\("), "console.*(")]
PRINT_CALL_PATTERNS[".ts"] = _TS_PRINT; PRINT_CALL_PATTERNS[".tsx"] = _TS_PRINT
LOG_EXIT_FILES |= {"src/lib/log.ts"}
UI_TESTID_RULES += [(re.compile(r"\.tsx$"),
                     re.compile(r"<(?:button|a|input|select|textarea|[A-Z]\w*)\b[^>]*on(?:Click|Submit|Change)=[^>]*>"),
                     re.compile(r"data-testid\s*="),
                     "React操作要素")]
ORPHAN_UNIVERSES += [(["src/"], ".ts", [re.compile(r"(^|/)main\.tsx?$"), re.compile(r"vite\.config")]),
                     (["src/"], ".tsx", [re.compile(r"(^|/)main\.tsx?$")])]
IMPORT_TARGET_EXTRACTORS[".ts"] = _ts_import_targets
IMPORT_TARGET_EXTRACTORS[".tsx"] = _ts_import_targets
SYMBOL_EXTRACTORS[".ts"] = _ts_public_symbols
SYMBOL_EXTRACTORS[".tsx"] = _ts_public_symbols
_TS_DEPRECATED = [(re.compile(r"@supabase/auth-helpers-nextjs"),
                   "@supabase/auth-helpers-nextjs（公式非推奨。@supabase/ssr へ移行 — 出典①②）")]
DEPRECATED_PATTERNS[".ts"] = _TS_DEPRECATED; DEPRECATED_PATTERNS[".tsx"] = _TS_DEPRECATED
PLAN_LAYER_ROOTS += ["src"]
SINGLE_TEST_COMMAND = ["npx", "vitest", "run", "{file}"]   # 単一スロット（併用時はプライマリ列のみ — §5）
```

**paste-block（`scripts/dev.py` COMMANDS へ）**:

```python
COMMANDS = {
    "up":    [["supabase", "start"]],
    "reset": [["supabase", "db", "reset"]],
    "seed":  [["supabase", "db", "reset"]],
    "time":  [["uv", "run", "scripts/set_time.py", "{args}"]],  # .env.local の VITE_TIME_FREEZE を書く小物（Step 8b で作成）
    "test":  [["npx", "vitest", "run"]],
    "e2e":   [["npx", "playwright", "test"]],
    "fmt":   [["npx", "prettier", "--write", "."]],
    "check": [["uv", "run", "scripts/check_structure.py"]],
    "db":    [["psql", "postgresql://postgres:postgres@127.0.0.1:54322/postgres", "-c", "{args}"]],
}
```

**paste-block（`post_edit_format.py` の DISPATCH へ — v2.24でPython化。直接バイナリ呼び出し）**:

`npx` は使わない——ローカル install 済みの `prettier` でも `npx prettier --version` は実測
約900ms/回、`node_modules/.bin/prettier` の直接呼び出しなら約240ms/回（差の680msの大半は
npx自身の解決コストでNode起動コストではない。編集の度に発火するホットパスでは、この差が
フック本体の言語移行より効く — §7.7・G11）。

```python
DISPATCH[".ts"] = DISPATCH[".tsx"] = [["node_modules/.bin/prettier", "--write", "{file}"]]
```

**paste-block（`post_edit_lint.py` の DISPATCH へ — v2.5導入・v2.24でPython化）**:

```python
_ESLINT = [["node_modules/.bin/eslint", "--max-warnings=0", "{file}"]]
DISPATCH[".ts"] = DISPATCH[".tsx"] = DISPATCH[".js"] = DISPATCH[".jsx"] = _ESLINT
```

**代替案（最速志向・要実測): Biome への統合**——単一ネイティブバイナリで format+lint+import整理
を1execで済ませる（prettier+eslintの2exec構成より起動コストが半分で済む）。公開ベンチマークで
ESLintの10〜35倍・Prettierの35倍という報告があり（出典下記）、Rust製で Node ランタイム自体の
起動コストも無い。採用する場合は `DISPATCH[".ts"] = [["node_modules/.bin/biome", "check",
"--write", "{file}"]]` の1行に統合できる。本キットはprettier+eslintを既定のまま維持——
乗り換えは各プロジェクトの判断（列の版上げで記録）。
出典: [Biome migration guide 2026](https://dev.to/pockit_tools/biome-the-eslint-and-prettier-killer-complete-migration-guide-for-2026-27m)・
[ESLint vs Biome comparison](https://reintech.io/blog/eslint-vs-biome-javascript-linting-comparison-2026)。

**paste-block（`.pre-commit-config.yaml` の BINDING へ）**:

```yaml
      - id: tsc
        name: "tsc --noEmit (pre-push — §4)"
        entry: bash -c 'npx tsc --noEmit'
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
      - id: eslint
        name: "eslint (pre-push — §4)"
        entry: bash -c 'npx eslint .'
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
      - id: vitest
        name: "vitest run (pre-push — §4)"
        entry: bash -c 'npx vitest run'
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
```

**paste-block（`guardrails-ci.yml` の BINDING へ）**:

```yaml
  ts-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx eslint .
      - run: npx vitest run

  e2e:   # §12.4 の操作レールを PR の赤/緑へ変換（Step 8b DoD）
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: supabase/setup-cli@v1
      - run: supabase start
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
```

**paste-block（`guardrails-ci.yml` red-first ジョブの BINDING へ — v2.7）**:

```yaml
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
```

**paste-block（リポジトリ直下 `.mcp.json` — 操作レール）**:

```json
{
  "mcpServers": {
    "playwright": { "command": "npx", "args": ["@playwright/mcp@latest"] }
  }
}
```

---

## 列: python-uv@6 — Python（uv・CLI/バックエンド）【要実測】

> @6（v2.20）: ログ単一出口 `log_op` の実サンプル（下記 paste-block）と `LOG_BOUNDARY_PATTERNS`
> 行を追加。フィールド設計は OpenTelemetry Logs Data Model の命名（timestamp/severity/body/
> attributes 相当）に揃え、独自スキーマの発明を避けた（出典は下記）。**`log_op` 実行して
> 有効なJSON1行×3ケースを確認**、**`LOG_BOUNDARY_PATTERNS`/`LOG_CALL_PATTERN` も
> `check_log_boundary_coverage` に直接通して4ケースDoD実測**（① except無ログ→SOFT 1行
> ② HTTP呼び出し無ログ→SOFT 1行 ③ `log_op` 被覆→沈黙 ④ `NO-LOG:` 理由→沈黙）。
> この2行は実測済みとしてよいが、列の他の行（テスト・E2E・依存マニフェスト等）は
> 過去版のまま個別ステータスを維持——列全体の一括昇格はしない（G13の「値ごとに実測状態を
> 持つ」原則）ため見出しは引き続き【要実測】。
> @5（v2.7）: 「単一テストファイル実行」の1行と paste-block 1行を追加。red-first の機構自体は本キットの DoD で python 系フィクスチャにより実測済み（親でも緑の fix→`red-first-green` 1行／親で赤→証明1行／EXEMPT→免除1行）。
> @4（v2.6）: 「非推奨・世代交代パターン」「設計根拠の対象レイヤー」の2行と paste-block の追記。deprecated-api の paste-block は本キットの DoD で実測済み（`utcnow(` 注入→`HARD:deprecated-api` 1行・除去→沈黙・未走査拡張子注入→`binding-dead-pattern`・70ms）。
> @3（v2.5）: 「編集直後 lint」「依存マニフェスト」の2行と `post_edit_lint.sh` paste-block を追加。lint paste-block は本キットの DoD で実測済み（違反→exit 2＋stderr／クリーン→0／uvx 不在・実行不能→表示素通し／62ms）。

前提ツール: uv のみ（Python 自体も uv が解決 — §7.1）。

| 行 | 値 |
|---|---|
| 整形（冪等） | `uvx ruff format <file>` |
| 編集直後 lint | `uvx ruff check <file>`（rc=1 のみブロック。下の paste-block） |
| 静的解析 | `uvx ruff check .` |
| lint昇格 | ruff: `T201`（print）・`E722`（裸except）を select に含める |
| テスト | `uv run pytest -q` |
| E2E | CLI なら subprocess 経由の統合テスト（操作レール=そのまま実行） |
| print系直呼び | `print(`（出口: `src/<pkg>/log.py`） |
| ログ境界パターン | 外部HTTP呼び出し（`requests\.` `httpx\.`）・`except` 節開始行（`LOG_BOUNDARY_PATTERNS` — §8.4） |
| ログ呼び出しパターン | `log_op\(`（`LOG_CALL_PATTERN` — サンプル実装は下記） |
| テスト内 非決定 | `time.time(` `datetime.now(` `random.random(` `random.randint(`（seed/Clock注入） |
| テスト内 外部I/O | `requests.` `httpx.` `urllib.request` |
| 非推奨・世代交代パターン | `utcnow(`・`utcfromtimestamp(`（Python 3.12 で公式非推奨＝出典②。代替: `datetime.now(timezone.utc)` / `datetime.fromtimestamp(ts, timezone.utc)`） |
| テスト判別 | `^tests/` ・ `_test\.py$` ・ `test_.*\.py$` |
| 単一テストファイル実行 | `uv run pytest {file}`（cwd=ルート。red-first ジョブの BINDING 追加セットアップは不要——setup-uv で足りる — §5） |
| 依存マニフェスト | `pyproject.toml`（project.dependencies）— 既定表に同梱済み（確認のみ・追記不要） |
| 設計根拠の対象レイヤー | `src`（`PLAN_LAYER_ROOTS` — §3.4 検査5） |
| `up`/`reset`/`seed`/`time`/`db` | 構成依存（DBを持つならDBの reset/seed を配線。持たないなら「該当なし」） |
| 操作レール | subprocess で本体CLIを叩く（ブラウザ不要のためMCP不要） |
| 観察レール | stdout/stderr＋単一出口ログ |

**paste-block（`scripts/repo_scan.py` BINDING へ）**:

```python
CODE_EXTS |= {".py"}
TEST_PATH_PATTERNS += [re.compile(p) for p in (r"^tests/", r"_test\.py$", r"(^|/)test_[^/]+\.py$")]
SLEEP_PATTERNS[".py"] = [(re.compile(r"\btime\.sleep\s*\("), "time.sleep")]
NONDETERMINISM_PATTERNS[".py"] = [
    (re.compile(r"\bdatetime\.now\s*\(|\btime\.time\s*\("), "現在時刻（Clock/引数で注入する）"),
    (re.compile(r"\brandom\.(random|randint|choice)\s*\("), "seedなし乱数（Random(seed)を注入する）")]
TEST_NETWORK_PATTERNS[".py"] = [
    (re.compile(r"\brequests\.|\bhttpx\.|\burllib\.request"), "requests/httpx/urllib")]
PRINT_CALL_PATTERNS[".py"] = [(re.compile(r"(?<![\w.])print\s*\("), "print(")]
LOG_BOUNDARY_PATTERNS[".py"] = [
    (re.compile(r"\brequests\.(get|post|put|delete|patch)\s*\(|\bhttpx\.(get|post|put|delete|patch)\s*\("),
     "外部HTTP呼び出し"),
    (re.compile(r"^\s*except\b"), "エラーハンドラ")]
LOG_CALL_PATTERN[".py"] = re.compile(r"\blog_op\s*\(")
DEPRECATED_PATTERNS[".py"] = [
    (re.compile(r"\butcnow\s*\("), "datetime.utcnow()（3.12 で非推奨。datetime.now(timezone.utc) へ）"),
    (re.compile(r"\butcfromtimestamp\s*\("), "datetime.utcfromtimestamp()（3.12 で非推奨。fromtimestamp(ts, timezone.utc) へ）")]
PLAN_LAYER_ROOTS += ["src"]
SINGLE_TEST_COMMAND = ["uv", "run", "pytest", "{file}"]   # 単一スロット（併用時はプライマリ列のみ — §5）
LOG_EXIT_FILES |= {"src/log.py"}   # 実パスへ調整（scripts/ 配下は LOG_EXIT_PREFIXES が既定除外 — §3.3）
# ORPHAN_UNIVERSES は既定のまま不発（Pythonのimport解決は近似が粗い。必要なら列を版上げ）
# SYMBOL_EXTRACTORS[".py"] は出荷既定で有効（キット自身の索引のため）——追記不要
```

`dev.py` COMMANDS: `test=[["uv","run","pytest","-q"]]`・`fmt=[["uvx","ruff","format","."]]`、
残りは構成依存で充填。pre-push/CI は ruff check・pytest を ts 列と同じ形で並べる。
`post_edit_format.py` DISPATCH: `DISPATCH[".py"] = [["ruff", "format", "{file}"]]`
（`uv tool install ruff` 前提——直接バイナリの理由は下の lint paste-block 注記と同じ。
キットの `scripts/*.py` にも当たる）。

**サンプル実装（`src/log.py` へ配置——§8.2・§8.4 の単一出口。実行して有効なJSON出力を
確認済み・2026-07-08）**:

出典（独自スキーマを発明せず、以下の収斂点に揃えた）: OpenTelemetry Logs Data Model
（`timestamp`/`severity`/`body`/`attributes` 相当の命名）・構造化ログの実務コンセンサス
（ISO 8601 UTC の `timestamp`・`level`・相関ID用の `trace_id`）・12-factor app「ログは
イベントストリームとして扱う」（ファイル管理をアプリでせず、unbuffered stdout へ書いて
集約は環境側に委ねる）。呼び出し規約（`tag`/`op`/`detail`/`error`/`elapsed`）は
GUARDRAILS.md §8.2 の既存シグネチャをそのまま踏襲——**呼び出し側のインターフェースは
変えず、出力の中身だけを構造化した**。

```python
"""log.py -- 単一出口のログ実装（GUARDRAILS.md §8.2・§8.4）。1行1JSON・stdout unbuffered。"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone


def log_op(
    tag: str,
    op: str,
    detail: str,
    *,
    error: BaseException | str | None = None,
    elapsed_ms: int | float | None = None,
    level: str | None = None,
    trace_id: str | None = None,
) -> None:
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "level": level or ("ERROR" if error is not None else "INFO"),
        "tag": tag,
        "op": op,
        "message": detail,
    }
    if elapsed_ms is not None:
        record["elapsed_ms"] = elapsed_ms
    if error is not None:
        record["error"] = str(error)
    if trace_id is not None:
        record["trace_id"] = trace_id
    print(json.dumps(record, ensure_ascii=False), flush=True, file=sys.stdout)
```

実行結果（`log_op("api","fetch_user","user retrieved",elapsed_ms=42)` 等3ケース）:

```
{"timestamp": "2026-07-07T22:44:37.524Z", "level": "INFO", "tag": "api", "op": "fetch_user", "message": "user retrieved", "elapsed_ms": 42}
{"timestamp": "2026-07-07T22:44:37.525Z", "level": "ERROR", "tag": "api", "op": "fetch_user", "message": "not found", "elapsed_ms": 8, "error": "404"}
{"timestamp": "2026-07-07T22:44:37.525Z", "level": "WARN", "tag": "db", "op": "query", "message": "slow query", "elapsed_ms": 1200}
```

**このサンプルが規定しないもの**（§8.4 の境界どおり——プロジェクトが決める）: `service`
（実行主体名）・`trace_id` の実際の伝播経路（contextvars 等でのミドルウェア配線）・
出力先の変更（stdoutのまま集約サービスに渡すのが12-factor流だが、ファイル直書きに
変えるのも自由）・ログレベルのフィルタリング閾値。**変更したら列の版を上げて記録する**
（G5）。

**paste-block（`post_edit_lint.py` の DISPATCH へ — v2.5導入・v2.24でPython化。実測済み）**:

`uvx ruff` ではなく `uv tool install ruff` で直接PATHへ入れたバイナリを叩く——実測:
`uvx ruff --version` 約218ms/回 → 直接 `ruff --version` 約156ms/回（Windows実機）。
`uvx`は毎回ツールの解決を行うため、編集の度に発火するホットパスでは差が積む。
Step 0で `uv tool install ruff` を実行してから以下を充填する（前提: PATHにruffが通ること）。

```python
DISPATCH[".py"] = [["ruff", "check", "{file}"]]
```

（`uv tool install ruff` を実行しない/できない環境では `["uvx", "ruff", "check", "{file}"]`
のまま使ってもよい——動作は同じで約60ms/回遅いだけ。速度より導入の手軽さを優先する
判断も正当。DoD実測: 違反→exit 2＋stderr／クリーン→exit 0／ツール未導入→表示素通し）

---

## 列: dart-flutter@4 — Dart（Flutter・app/ 層）【ゲート系=移植元で実測済み／ランタイム系=要実測】

> @4（v2.7）: 「単一テストファイル実行」の1行と paste-block 2行を追加（多層構成のため cwd スロット `SINGLE_TEST_CWD` を使う——{file} は app/ 相対に展開）【要実測】。
> @3（v2.6）: 「非推奨・世代交代パターン」（該当なし判断）「設計根拠の対象レイヤー」の2行と paste-block 1行を追加。
> @2（v2.5）: 「編集直後 lint」「依存マニフェスト」の2行を追加（lint は該当なし判断——判断もカタログに記録する）。

前提ツール: Flutter SDK。実測元: 移植元プロジェクト（シフト最適化アプリ）。

| 行 | 値 |
|---|---|
| 整形（冪等） | `dart format <file>` |
| 編集直後 lint | 該当なし（`dart analyze` は単一ファイルでもアナリシスサーバ起動が3秒予算に収まらない — push 段 §4 で回収） |
| 静的解析 | `flutter analyze --fatal-infos`（`app/` にて） |
| lint昇格 | `analysis_options.yaml`: `avoid_print`・`empty_catches` を error 昇格（§8.1） |
| テスト | `flutter test` |
| E2E | `flutter test integration_test`（デスクトップは `-d windows` 等） |
| print系直呼び | `debugPrint(` `print(`（出口: `app/lib/services/log.dart` の `logOp`） |
| テスト内 非決定 | `DateTime.now()`・引数なし `Random()` |
| テスト内 外部I/O | `http.get(` `http.post(` `HttpClient(`（フェイク注入） |
| テスト判別 | `^app/test/`・`^app/integration_test/`・`_test\.dart$` |
| 単一テストファイル実行 | `flutter test {file}`（`SINGLE_TEST_CWD = "app"`——{file} は app/ 相対に展開。rust 併用時は dart 側を配線し engine/ のテストは対象外1行で見える — §5。red-first ジョブの BINDING: `subosito/flutter-action@v2`）【要実測】 |
| 非推奨・世代交代パターン | 該当なし（出典①②で裏取りできた初期値が現時点で無い——③コミュニティ由来は初期値にしない＝出典規律。見つけたら版上げで還元） |
| 依存マニフェスト | `pubspec.yaml`（dependencies / dev_dependencies）— 既定表に同梱済み（確認のみ・追記不要） |
| 設計根拠の対象レイヤー | `app/lib`（`PLAN_LAYER_ROOTS` — §3.4 検査5） |
| 生成物 | `.g.dart`・`.freezed.dart`・`frb_generated`・`bridge_generated`・`.dart_tool/` |
| 操作レール | integration_test（アプリ内貫通）。外部からの実UI操作が要るなら maestro を検討【要実測】 |
| 観察レール | `flutter logs`＋単一出口 `logOp` |

**paste-block（`scripts/repo_scan.py` BINDING へ）**:

```python
CODE_EXTS |= {".dart"}
HEADER_REQUIRED_EXTS |= {".dart"}
TEST_PATH_PATTERNS += [re.compile(p) for p in (r"^app/test/", r"^app/integration_test/", r"_test\.dart$")]
GENERATED_PATTERNS += [re.compile(p) for p in (r"\.g\.dart$", r"\.freezed\.dart$",
                                               r"(^|/)frb_generated", r"(^|/)bridge_generated")]
SLEEP_PATTERNS[".dart"] = [(re.compile(r"\bFuture\.delayed\b"), "Future.delayed"),
                           (re.compile(r"\bsleep\s*\("), "sleep()")]
NONDETERMINISM_PATTERNS[".dart"] = [
    (re.compile(r"\bDateTime\.now\s*\("), "DateTime.now()（時刻は固定値/Clock抽象で注入する）"),
    (re.compile(r"\bRandom\s*\(\s*\)"), "seed なし Random()（Random(42) のように seed を固定する）")]
TEST_NETWORK_PATTERNS[".dart"] = [(re.compile(r"\bhttp\.(get|post)\s*\(|\bHttpClient\s*\("), "http直呼び")]
PRINT_CALL_PATTERNS[".dart"] = [(re.compile(r"\bdebugPrint\s*\("), "debugPrint("),
                                (re.compile(r"(?<![\w.$])print\s*\("), "print(")]
LOG_EXIT_FILES |= {"app/lib/services/log.dart"}
ORPHAN_UNIVERSES += [(["app/lib/"], ".dart",
                      [re.compile(r"(^|/)lib/main\.dart$"), re.compile(r"(^|/)bin/[^/]+\.dart$")])]
IMPORT_TARGET_EXTRACTORS[".dart"] = _dart_import_targets
SYMBOL_EXTRACTORS[".dart"] = _dart_public_symbols
PLAN_LAYER_ROOTS += ["app/lib"]
SINGLE_TEST_COMMAND = ["flutter", "test", "{file}"]   # 単一スロット: rust 併用時も dart 側を配線（§5）
SINGLE_TEST_CWD = "app"
REQUIRED_PATHS += ["app"]
REQUIRED_SOFT_PATHS += ["app/CLAUDE.md"]
```

`post_edit_format.py` DISPATCH: `DISPATCH[".dart"] = [["dart", "format", "{file}"]]`
（`dart format` は Dart SDK 同梱のネイティブツールでラッパー越しではない——npx/uvx
相当の追加コストは元から無い。**`--set-exit-if-changed` は付けない**——post_edit_format.py
は非0を「整形失敗＝構文エラーの可能性」としてブロックする契約なので、そのフラグを付けると
「変更があっただけ」でも exit 2 になり誤ってブロックする。失敗時 exit 2、原本と同じ）。
pre-push/CI: `flutter analyze --fatal-infos`・`flutter test`（`cd app`）。CI は `subosito/flutter-action@v2`。

---

## 列: rust@4 — Rust（engine/ 層・ソルバー等）【ゲート系=移植元で実測済み／ランタイム系=要実測】

> @4（v2.7）: 「単一テストファイル実行」の1行を追加——**該当なし＋代替**の判断ごと記録（paste-block の変更なし）。
> @3（v2.6）: 「非推奨・世代交代パターン」（該当なし判断）「設計根拠の対象レイヤー」の2行と paste-block 1行を追加。
> @2（v2.5）: 「編集直後 lint」「依存マニフェスト」の2行を追加（lint は該当なし判断——判断もカタログに記録する）。

前提ツール: Rust toolchain（`engine/rust-toolchain.toml` で固定 — §5）。実測元: 移植元プロジェクト。

| 行 | 値 |
|---|---|
| 整形（冪等） | `cargo fmt`（crate ルートで） |
| 編集直後 lint | 該当なし（clippy は単一ファイル非対応でクレート全体のビルドが走り3秒予算に収まらない — push 段 §4 で回収） |
| 静的解析 | `cargo clippy --all-targets -- -D warnings` |
| lint昇格 | `Cargo.toml [lints.clippy]`: `print_stdout`・`print_stderr`・`dbg_macro` を deny |
| テスト | `cargo test` |
| print系直呼び | `println!` `eprintln!` `dbg!`（出口: `engine/src/logging.rs`） |
| テスト内 非決定 | `thread_rng`・`SystemTime::now` |
| テスト内 外部I/O | `reqwest::`・`std::net::TcpStream` |
| テスト判別 | `^engine/tests/`・`_test\.rs$`・`(^|/)tests/[^/]+\.rs$` |
| 単一テストファイル実行 | 該当なし（モジュール内 `#[cfg(test)]` の単独実行が構造的に不能。代替: 統合テスト（`engine/tests/`）限定なら `cargo test --test <名前>` が可——ファイル名でなくテスト名を取るためスロットのトークン拡張が要り、必要になった時に版上げで検討。dart 併用構成では dart 側の配線が優先され、rust テストは対象外1行で見える — §5） |
| 非推奨・世代交代パターン | 該当なし（出典①②で裏取りできた初期値が現時点で無い——コンパイラ・clippy の deprecation 警告が同役を担う言語のため、列で重ねる価値が薄い。見つけたら版上げで還元） |
| 依存マニフェスト | `Cargo.toml`（dependencies。`[dependencies.x]` サブテーブル形式も検知）— 既定表に同梱済み（確認のみ・追記不要） |
| 設計根拠の対象レイヤー | `engine/src`（`PLAN_LAYER_ROOTS` — §3.4 検査5） |
| 確率的コンポーネント | ソルバー有りなら `solve_for_test(input, seed, max_time)` ラッパー必須（§9.1・同一seed2回一致） |
| 境界検査 | FFI境界（例 `^engine/src/api(/|\.rs$)`）に `catch_unwind` 必須（`missing-catch-unwind`） |

**paste-block（`scripts/repo_scan.py` BINDING へ）**:

```python
CODE_EXTS |= {".rs"}
HEADER_REQUIRED_EXTS |= {".rs"}
TEST_PATH_PATTERNS += [re.compile(p) for p in (r"^engine/tests/", r"_test\.rs$", r"(^|/)tests/[^/]+\.rs$")]
GENERATED_PATTERNS += [re.compile(r"(^|/)target/")]
SLEEP_PATTERNS[".rs"] = [(re.compile(r"\bthread::sleep\b|\bsleep\s*\("), "thread::sleep / sleep()")]
NONDETERMINISM_PATTERNS[".rs"] = [
    (re.compile(r"\bthread_rng\b"), "thread_rng（seed 固定の乱数生成器を使う）"),
    (re.compile(r"\bSystemTime::now\b"), "SystemTime::now（時刻は引数で注入する）")]
TEST_NETWORK_PATTERNS[".rs"] = [(re.compile(r"\breqwest::|\bTcpStream\b"), "reqwest/TcpStream")]
PRINT_CALL_PATTERNS[".rs"] = [(re.compile(r"\bprintln!\s*\("), "println!"),
                              (re.compile(r"\beprintln!\s*\("), "eprintln!"),
                              (re.compile(r"\bdbg!\s*\("), "dbg!")]
LOG_EXIT_FILES |= {"engine/src/logging.rs"}
FFI_BOUNDARY_FILE_PATTERNS = [re.compile(r"^engine/src/api(/|\.rs$)")]
SOLVER_DIRECT_CALL_PATTERNS = [(re.compile(r"\bsolve\s*\("), "ソルバー本体の直呼び")]  # ソルバー有りの場合
ORPHAN_UNIVERSES += [(["engine/src/"], ".rs",
                      [re.compile(p) for p in (r"(^|/)src/lib\.rs$", r"(^|/)src/main\.rs$",
                                               r"(^|/)build\.rs$", r"(^|/)src/bin/[^/]+\.rs$",
                                               r"(^|/)tests/[^/]+\.rs$", r"(^|/)benches/[^/]+\.rs$",
                                               r"(^|/)examples/[^/]+\.rs$")])]
IMPORT_TARGET_EXTRACTORS[".rs"] = _rust_mod_targets
SYMBOL_EXTRACTORS[".rs"] = _rust_public_symbols
PLAN_LAYER_ROOTS += ["engine/src"]
REQUIRED_PATHS += ["engine"]
REQUIRED_SOFT_PATHS += ["engine/CLAUDE.md"]
```

`post_edit_format.py` DISPATCH: `DISPATCH[".rs"] = [["rustfmt", "{file}"]]`（原本の
`cargo fmt` はクレート単位で cwd 切替が要るが、post_edit_format.py の DISPATCH は
1コマンド1ファイルの単純な argv 実行のみを想定するため、`cargo fmt` が内部で呼ぶ
`rustfmt` を単一ファイルに直接向ける形へ変更した——ネイティブバイナリでラッパー越しでも
なく、post-edit の「1ファイル・数秒予算」という契約そのものにも rustfmt 単体呼び出しの
方が合っている。cwd切替が要る場合は列側で argv を `["bash","-c","cd \"$(dirname {file})\"
&& cargo fmt"]` のように組み立てる——DISPATCH は素の argv リストなので shell 機能が
要るケースは `bash -c` を1段挟む。）
pre-push/CI: `cargo clippy --all-targets -- -D warnings`・`cargo test`・`cargo fmt --check`（`dtolnay/rust-toolchain`＋`Swatinem/rust-cache`）。

---

## 列: ts-react-crx@1 — TypeScript + React + Vite（Chrome拡張機能・Manifest V3・新しいタブ上書き）【要実測】

> @1（2026-07-08・new-tab-board リポジトリで新設）: ts-react-web@6 を土台に、Chrome拡張
> 固有の差分（Supabase/PWA要素を除去し chrome.storage.local を唯一の外部I/Oとして採用・
> Manifest V3 の非推奨API・拡張機能読み込みが要る E2E ハーネス）を反映して新規に起こした列。
> 確率的コンポーネントは無し（表B）。外部I/Oは chrome.storage.local/sync のみ（表D）。

前提ツール: Node.js（npm/npx）・Playwright（拡張機能読み込みには headed Chromium が必要）。

**構成（表B）**: レイヤーは `src/lib`（外部I/O・ログ・時刻の**シーム**——依存の起点にしない）
と `src/newtab`（UI。`lib` に依存してよい）の一方向のみ（`newtab → lib`。`lib` が `newtab`
を import するのは禁止）。必須ディレクトリ: `src`・`src/lib`・`src/newtab`・`e2e`。
確率的コンポーネント: **無**。外部I/O: **chrome.storage.local のみ**（`src/lib/storage.ts`
がシーム。ネットワーク呼び出しは無し——`test-network` パターンは将来の混入に備え防御的に有効化）。

| 行 | 値 |
|---|---|
| 整形（冪等） | `npx prettier --write <file>` |
| 編集直後 lint | `npx --no-install eslint --max-warnings=0 <file>`（rc=1 のみブロック。下の paste-block） |
| 静的解析 | `npx tsc --noEmit` ＋ `npx eslint .` |
| lint昇格 | eslint: `no-console: error`（`src/lib/log.ts` のみ off）・`no-empty: error` |
| テスト | `npx vitest run` |
| E2E | `npx playwright test`（`e2e/fixtures.ts` が `dist/` をビルド済み拡張として persistent context にロード——headed 必須・CI は `xvfb-run`） |
| print系直呼び | `console.log(` `console.info(` `console.debug(`（出口: `src/lib/log.ts`） |
| ログ単一出口 | `src/lib/log.ts` の `logOp(tag, op, detail, {error, elapsedMs})`（形式は AGENTS.md §7） |
| ログ境界パターン | `chrome\.storage\.(local|sync)\.(get|set)\(`（外部I/O）・`^\s*catch\b`（エラーハンドラ） |
| ログ呼び出しパターン | `logOp\(` |
| テスト内 非決定 | `Date.now(` ・ `new Date()`（引数なし）・ `Math.random(`（Clock/seed注入で代替） |
| テスト内 外部I/O | `fetch(` `axios` `XMLHttpRequest`（本アプリは使わない防御的パターン。フェイク/記録済みフィクスチャを注入） |
| 非推奨・世代交代パターン | `chrome.tabs.executeScript(`（MV3 で非推奨。`chrome.scripting.executeScript` へ——公式 MV3 移行ガイド＝出典②）・`chrome.extension.sendMessage(`（`chrome.runtime.sendMessage` へ——同ガイド） |
| テスト判別 | `\.test\.tsx?$` ・ `^e2e/.*\.spec\.ts$`（E2E specを含める＝fix⇔テスト対の対象 — G10） |
| 単一テストファイル実行 | `npx vitest run {file}`（cwd=ルート） |
| 依存マニフェスト | `package.json`（dependencies / devDependencies）— 既定表に同梱済み（確認のみ） |
| 設計根拠の対象レイヤー | `src`（`PLAN_LAYER_ROOTS`） |
| 生成物 | `dist/`（vite build 出力。既定の `GENERATED_PATTERNS` に同梱済み） |
| `up` | `npm run build -- --watch`（vite が `dist/` を継続ビルド。`chrome://extensions` で読み込み） |
| `reset` | `node scripts/reset-e2e-profile.mjs`（E2E persistent context のプロファイルディレクトリを削除——次回起動は空の chrome.storage から） |
| `seed` | `node scripts/seed-board.mjs`（persistent context を起動し `chrome.storage.local` に固定フィクスチャの board を書き込んで閉じる） |
| `time` | `node scripts/set-time-freeze.mjs {args}`（`.time-freeze.json` を書換/削除。`e2e/fixtures.ts` が起動時に読み `window.__TIME_FREEZE__` を注入。`src/lib/clock.ts` がこれを読む — §12.2） |
| `db` | `node scripts/dump-storage.mjs`（persistent context で `chrome.storage.local.get(null)` を評価しJSON出力——観察レール） |
| 操作レール | **Playwright MCP** を `npm run dev`（Vite dev server・`localhost`）へ向ける。`src/lib/storage.ts` は `chrome.*` 不在時 `localStorage` にフォールバックするため、MCP は特別な起動オプション無しで新しいタブUIを直接操作できる（アクセシビリティスナップショットで読む — §12.4） |
| 観察レール | Playwright MCP のコンソール/ネットワーク読取・`dev.py db`（実拡張の chrome.storage 読取） |
| UIテストID | 対象 `\.tsx$`・要素 `<(button|a|input|select|textarea|[A-Z]\w*)\b[^>]*on(Click|Submit|Change)=[^>]*>`・属性 `data-testid\s*=` |
| 外部I/Oシーム | `src/lib/storage.ts`（chrome.storage.local ⇔ localStorage フォールバックを1箇所に集約。UI 層は直接 `chrome.storage` / `localStorage` を叩かない） |

**paste-block（`scripts/repo_scan.py` BINDING へ）**:

```python
CODE_EXTS |= {".ts", ".tsx"}
HEADER_REQUIRED_EXTS |= {".ts", ".tsx"}
TEST_PATH_PATTERNS += [re.compile(p) for p in (r"\.test\.tsx?$", r"^e2e/.*\.spec\.ts$")]
_TS_SLEEP = [(re.compile(r"\bsetTimeout\s*\(|\bsleep\s*\("), "setTimeout/sleep")]
SLEEP_PATTERNS[".ts"] = _TS_SLEEP; SLEEP_PATTERNS[".tsx"] = _TS_SLEEP
_TS_NONDET = [(re.compile(r"\bDate\.now\s*\("), "Date.now()（Clock抽象で注入する）"),
              (re.compile(r"\bnew Date\s*\(\s*\)"), "引数なし new Date()（固定時刻を渡す）"),
              (re.compile(r"\bMath\.random\s*\("), "Math.random()（seed付き乱数を注入する）")]
NONDETERMINISM_PATTERNS[".ts"] = _TS_NONDET; NONDETERMINISM_PATTERNS[".tsx"] = _TS_NONDET
_TS_NET = [(re.compile(r"\bfetch\s*\(|\baxios\b|\bXMLHttpRequest\b"), "fetch/axios/XHR")]
TEST_NETWORK_PATTERNS[".ts"] = _TS_NET; TEST_NETWORK_PATTERNS[".tsx"] = _TS_NET
_TS_PRINT = [(re.compile(r"\bconsole\.(log|info|debug)\s*\("), "console.*(")]
PRINT_CALL_PATTERNS[".ts"] = _TS_PRINT; PRINT_CALL_PATTERNS[".tsx"] = _TS_PRINT
LOG_EXIT_FILES |= {"src/lib/log.ts"}
_TS_LOG_BOUNDARY = [(re.compile(r"\bchrome\.storage\.(?:local|sync)\.(?:get|set)\s*\("), "chrome.storage I/O"),
                    (re.compile(r"^\s*catch\b"), "エラーハンドラ")]
LOG_BOUNDARY_PATTERNS[".ts"] = _TS_LOG_BOUNDARY; LOG_BOUNDARY_PATTERNS[".tsx"] = _TS_LOG_BOUNDARY
LOG_CALL_PATTERN[".ts"] = re.compile(r"\blogOp\s*\("); LOG_CALL_PATTERN[".tsx"] = re.compile(r"\blogOp\s*\(")
UI_TESTID_RULES += [(re.compile(r"\.tsx$"),
                     re.compile(r"<(?:button|a|input|select|textarea|[A-Z]\w*)\b[^>]*on(?:Click|Submit|Change)=[^>]*>"),
                     re.compile(r"data-testid\s*="),
                     "React操作要素")]
ORPHAN_UNIVERSES += [(["src/"], ".ts", [re.compile(r"(^|/)main\.tsx?$"), re.compile(r"vite\.config")]),
                     (["src/"], ".tsx", [re.compile(r"(^|/)main\.tsx?$")])]
IMPORT_TARGET_EXTRACTORS[".ts"] = _ts_import_targets
IMPORT_TARGET_EXTRACTORS[".tsx"] = _ts_import_targets
SYMBOL_EXTRACTORS[".ts"] = _ts_public_symbols
SYMBOL_EXTRACTORS[".tsx"] = _ts_public_symbols
_TS_DEPRECATED = [(re.compile(r"\bchrome\.tabs\.executeScript\s*\("),
                   "chrome.tabs.executeScript（MV3で非推奨。chrome.scripting.executeScript へ — 出典②公式MV3移行ガイド）"),
                  (re.compile(r"\bchrome\.extension\.sendMessage\s*\("),
                   "chrome.extension.sendMessage（chrome.runtime.sendMessage へ — 出典②同ガイド）")]
DEPRECATED_PATTERNS[".ts"] = _TS_DEPRECATED; DEPRECATED_PATTERNS[".tsx"] = _TS_DEPRECATED
PLAN_LAYER_ROOTS += ["src"]
LAYER_FORBIDDEN_IMPORTS += [
    ("src/lib/", re.compile(r"""from\s+['"][^'"]*newtab[^'"]*['"]"""),
     "src/lib は src/newtab を import してはいけない（依存は newtab → lib の一方向のみ）"),
]
REQUIRED_PATHS += ["src", "src/lib", "src/newtab", "e2e"]
SINGLE_TEST_COMMAND = ["npx", "vitest", "run", "{file}"]   # 単一スロット
```

**paste-block（`scripts/dev.py` COMMANDS へ）**:

```python
COMMANDS = {
    "up":    [["npm", "run", "build", "--", "--watch"]],
    "reset": [["node", "scripts/reset-e2e-profile.mjs"]],
    "seed":  [["node", "scripts/seed-board.mjs"]],
    "time":  [["node", "scripts/set-time-freeze.mjs", "{args}"]],
    "test":  [["npx", "vitest", "run"]],
    "e2e":   [["npx", "playwright", "test"]],
    "fmt":   [["npx", "prettier", "--write", "."]],
    "check": [["uv", "run", "scripts/check_structure.py"]],
    "db":    [["node", "scripts/dump-storage.mjs"]],
}
```

**paste-block（`post_edit_format.py` の DISPATCH へ。直接バイナリ呼び出し）**:

```python
DISPATCH[".ts"] = DISPATCH[".tsx"] = [["node_modules/.bin/prettier", "--write", "{file}"]]
```

**paste-block（`post_edit_lint.py` の DISPATCH へ）**:

```python
_ESLINT = [["node_modules/.bin/eslint", "--max-warnings=0", "{file}"]]
DISPATCH[".ts"] = DISPATCH[".tsx"] = DISPATCH[".js"] = DISPATCH[".jsx"] = _ESLINT
```

**paste-block（`.pre-commit-config.yaml` の BINDING へ）**:

```yaml
      - id: tsc
        name: "tsc --noEmit (pre-push — §4)"
        entry: bash -c 'npx tsc --noEmit'
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
      - id: eslint
        name: "eslint (pre-push — §4)"
        entry: bash -c 'npx eslint .'
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
      - id: vitest
        name: "vitest run (pre-push — §4)"
        entry: bash -c 'npx vitest run'
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
```

**paste-block（`guardrails-ci.yml` の BINDING へ）**:

```yaml
  ts-test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx eslint .
      - run: npx vitest run

  e2e:   # §12.4 の操作レールを PR の赤/緑へ変換（Step 8b DoD）
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: xvfb-run --auto-servernum npx playwright test
```

**paste-block（`guardrails-ci.yml` red-first ジョブの BINDING へ）**:

```yaml
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
```

**代替案（要実測）**: Biome への統合は ts-react-web@6 の注記と同じ判断が適用できる
（本キットは prettier+eslint を既定のまま維持。乗り換えは版上げで記録）。

---

## この文書自体の運用ルール

- 列の値を採用先で修正したら、**必ずこの正本へ版上げで還元する**（採用先ローカルの黙修正は
  `binding-drift` 的なドリフトの人間版——禁止）。
- 「実測済み」への昇格は、採用リポジトリの Step DoD 通過（成功系＋違反注入）の事実をもって行い、
  列末尾に実測元と日付を1行残す。
- 複数列の併用（例: dart-flutter + rust）は可。**paste-block は必ず加算形**（`|=` / `+=` /
  キー代入）で書く——代入（`=`）は後から貼った列が先の列の設定を静かに消す（@2 で ts-react-web /
  python-uv を加算形に修正済み。新しい列もこの形式で起こす — G13/G5）。
  刻印はプライマリ列を1つ選んで統一する（例: `dart-flutter@4`）。
