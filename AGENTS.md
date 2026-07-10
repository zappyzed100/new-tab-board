# AGENTS.md — プロジェクト規約（このリポジトリで作業する**すべての**エージェントと人間の共通ルール）

本書が規約の正本。Codex / Cline / Cursor / Windsurf 等はルートの本ファイルを直読みし、
Claude Code は `CLAUDE.md` 冒頭の `@AGENTS.md` インポート経由で読む（GUARDRAILS.md §6。
本文をどちらかへ複製しない——分割であって複製ではないのがドリフトしない理由・G5）。
コミット・push・CI の門（GUARDRAILS.md §3〜§5）は git フックと CI なので**全エージェント共通**。
Claude Code だけが持つ追加の門（編集直後・操作直前・ターン終了のフック層）は `CLAUDE.md` 参照。

## §0 よく使うコマンド（ランタイム共通動詞 — GUARDRAILS.md §12.1）
すべて `uv run scripts/dev.py <動詞>`。動詞名は全プロジェクト共通・未配線は明示エラー
（採用列: ts-react-crx@1）:

| 動詞 | 何をするか |
|---|---|
| `up` | ローカル環境を起動する（冪等。`npm run build -- --watch` で `dist/` を継続ビルド） |
| `reset` | 既知状態へ戻す（seed込み — §12.2。E2E persistent context のプロファイルを削除） |
| `seed` | シードデータ投入（固定フィクスチャの board を chrome.storage.local へ書き込む） |
| `time <ISO8601>` / `time clear` | アプリ内時刻の凍結/解除 |
| `test` | 単体テスト（`vitest`） |
| `e2e` | E2E（実UI貫通。拡張機能を実際にロードした Playwright） |
| `fmt` | 整形（冪等・`prettier`） |
| `check` | 構造検査（§3.3） |
| `probe "<cmd>"` | 迂回防止（§2）への事前照会——実行前に ALLOW/DENY と理由を返す |
| `db "<SQL>"` | ローカルDBの読み取り（観察レール — §12.3。本プロジェクトは `chrome.storage.local` のダンプ） |

- 索引再生成: `uv run scripts/generate_structure.py`（STRUCTURE.md を書いてよい唯一の主体）
- 静的解析: `npx tsc --noEmit` ＋ `npx eslint .`（採用列の解析コマンド。pre-push で自動実行される）

## §1 ファイル規模
1ファイル500行以内を目安とする（超過は check-structure の soft 警告）。超えそうなら分割する。

## §2 フォルダ規模
1フォルダに CLAUDE.md 以外で7ファイルまでを目安とする（`scripts/` は例外）。
超えそうならサブフォルダへ整理する。

## §3 ファイル先頭ヘッダー
すべてのコードファイルの先頭に役割一行コメントを書く。書式: `<ファイル名> — 役割`
（例: `// App.tsx — 新しいタブのルートコンポーネント`、`# check_structure.py — 構造検査`）。

## §4 ドキュメントの置き場の分担
- 索引 = `STRUCTURE.md`（自動生成・手編集禁止）
- 設計根拠 = `plan.md`（無ければ作成時に）。plan は**小さなタスク（目安: 1タスク数分）
  ＋各タスクの検証コマンド**で書くと、中断・再開とレビューに強くなる（心得）。**レイヤー直下に新規ディレクトリを作る
  `feat:` は、設計根拠（`plan.md` / `docs/plans/`）の差分を同コミットに含める**
  （hard `feat-without-plan` が exit 1 でブロック — GUARDRAILS.md §3.4 検査5・G14。
  根拠は1行でよい。根拠を書けない構造変更は feat でなく refactor / chore を名乗る）
- 導入手順 = `README.md`
- 技術選定理由 = `docs/stack.md`（React+Vite+TypeScript を選んだ理由・chrome.storage のみで
  バックエンドを持たない設計判断）
- フォルダ固有知見 = 各フォルダの `CLAUDE.md`
- 出戻り防止の地図 = `docs/guardrails/GUARDRAILS.md`
- 目標の正本 = `docs/guardrails/GOALS.md`（規約・キットへの変更はGを引用する）
- バインディングの正本 = `bindings/catalog.md`（採用列: ts-react-crx@1）

## §5 フォルダ独立性・依存方向
レイヤーは2つ、依存は一方向のみ:

```
src/newtab/ (UI: React コンポーネント)
        │  依存してよい
        ▼
src/lib/    (シーム: storage.ts・log.ts・clock.ts。外部I/O・時刻・ログの唯一の入出口)
```

`src/lib/` が `src/newtab/` を import することは禁止（check-structure の hard
`layer-violation`）。UI 層は `chrome.storage` / `console.*` / `Date.now()` を直接叩かず、
必ず `src/lib/` のシーム経由にする（G6・G8）。

## §6 命名規則
- React コンポーネントファイル: `PascalCase.tsx`（例: `Board.tsx`・`Column.tsx`）。
- それ以外の TypeScript ファイル: `kebab-case.ts`（例: `storage.ts`・`log.ts`）。
- React カスタムフックは `useXxx` 命名（例: `useBoard.ts`）。
- テストファイルは対象と同名 + `.test.ts(x)`、E2E specは `e2e/*.spec.ts`。
- `data-testid` は `kebab-case`（例: `data-testid="add-card-button"`）。

## §7 ログ規則
- 秘匿: トークン・パスワード・APIキーをログに渡さない（コミット面は gitleaks が機械検査。
  ログ面はこの規約が最後の責務 — GUARDRAILS.md §8.3）。識別子は載せてよいが中身は載せない。
- 例外を握りつぶさない（空 catch 禁止 — lint で error 化）。
- 出力基準・形式: `[タグ] 操作名: 詳細 (+Xms)`。出口は単一化する
  （参照実装は `src/lib/log.ts` の `logOp`）。他ファイルでの print 系直呼びは hard `log-direct-call`。
- I/O・外部呼び出し・エラーハンドラの境界（`chrome.storage.*.get/set` 呼び出し・`catch` 節）は
  前後5行以内に `logOp` 呼び出しか `// NO-LOG: 理由` コメントのどちらかを書く
  （soft `missing-log-coverage` — GUARDRAILS.md §8.4）。**「この処理は重要だからログすべき」の
  判断は人間の仕事のまま**——機械が検査するのは存在だけで、`NO-LOG:` の理由の妥当性は検証
  しない。**レビューでは `NO-LOG:` の使用を必ず点検する**: 理由が具体的か・空虚な言い訳に
  なっていないか（RED-FIRST-EXEMPT の乱用監視と同じ運用 — GUARDRAILS.md §8.4・§10 Phase 31）。

## §8 テスト戦略
- テストが通る状態でのみコミットする（pre-push と CI が機械検査）。
- 一度直したバグは回帰テストに固定し、fix と同一コミットに同梱する
  （commit-msg フックの `fix-without-test` が機械検査）。
- **新機能（feat）もテストを同梱する**——テストが書けない feat は設計を疑う
  （soft `feat-without-test` が警告で可視化 — GUARDRAILS.md §3.4 検査6）。
- テストの重心は**リファクタリングで壊れない統合水準**に置く——モックの挙動だけを写した
  単体テストは実装の複製であり、守っているのはコードでなく書き方（心得）。
- LLM に書かせたテストは happy-path の自己検証に寄りやすい——**境界値と異常系を明示して
  発注**し、レビューではテストが「仕様」を主張しているか（実装の写しでないか）だけ見る（心得）。
- fix の同梱テストは**親コミットで赤**でなければならない（CI の `red-first` ジョブが
  機械証明・required — GUARDRAILS.md §5）。CI 上で赤にできない修正だけ、本文に
  `RED-FIRST-EXEMPT: 理由` を書く（理由は必須——空は無効）。**レビューでは EXEMPT の
  使用を必ず点検する**: 理由が具体的か・本当に CI 上で再現不能か・頻度が増えて
  いないか（乱用監視——required 運用の条件。GUARDRAILS.md §10 Phase 21）。
- flaky の温床を持ち込まない: テスト内の sleep・現在時刻・seed なし乱数・外部I/O直呼びは
  hard 違反（`test-sleep` / `test-nondeterminism` / `test-network`——時刻は `src/lib/clock.ts`
  の Clock 抽象、乱数は seed、外部I/Oはフェイクを注入する — GUARDRAILS.md §9.5・§12.2）。
  **非決定性の再現そのものがテストの本質という正当なケース**は、該当行の前後3行以内に
  `NONDETERMINISM-EXEMPT: 理由` コメントで免除できる（理由は必須——空は無効。**レビューでは
  EXEMPT の使用を必ず点検する**: `NO-LOG:` / `RED-FIRST-EXEMPT:` と同じ乱用監視 —
  GUARDRAILS.md §9.5・§10 Phase 35）。
- 確率的コンポーネントは無い（表B）——`solve_for_test` 相当のラッパーは本プロジェクトには
  該当しない。
- 本命の E2E: Playwright（`e2e/*.spec.ts`。`e2e/fixtures.ts` がビルド済み拡張を実際に
  persistent context へロードして検証する。`uv run scripts/dev.py e2e`）。**再現できたバグは
  修正前に E2E spec 化**し、fix と同一コミットへ（E2E パスはテスト判別規則に含める — §12.4）。
- UI の操作要素にはテストID属性を必ず付ける（hard `ui-missing-testid` — §12.4）。

## §9 ビルドと配布
- 開発ビルド: `npm run build -- --watch`（`dist/` を継続生成。`chrome://extensions` で
  デベロッパーモード→パッケージ化されていない拡張機能を読み込む→`dist/` を選択）。
- 本番ビルド: `npm run build`（`dist/` に Manifest V3 拡張一式が出力される）。
- Chrome Web Store への提出手順・バージョニング規約は、実際の提出が必要になった時点で
  本節に追記する（現状は未提出・手順未確定）。

## §10 Git 規則
- GitHub Flow: main へ直接 push しない。1トピック=1ブランチ=1PR。
- コミットは小さく（純変更 400 行超で soft `commit-too-large` が警告——生成物・lockfile は
  除外。大きな塊は「どの門が何を検証したか」を追えなくする — GUARDRAILS.md §3.4 検査7）。
- コミットメッセージ規約: `^(feat|fix|test|docs|refactor|chore): .+`
  （commit-msg フックが機械検査。Merge / Revert / fixup! / squash! は素通し）。
- `docs/guardrails/GOALS.md`・`docs/guardrails/GUARDRAILS.md`・`bindings/catalog.md` を変更するコミットは、本文に
  効くGを1行書く（例: `docs: §3.3 に規則追加（G4）` — `governance-without-goal` が機械検査）。
- **依存は増えてよいが、黙って増えてはならない**: 依存マニフェスト（`package.json` 等）に
  名前を足すコミットは、本文に `依存追加: <名前> — 理由1行` を書く（`undeclared-dependency`
  が機械検査 — GUARDRAILS.md §3.4 検査4。lockfile だけの更新・版上げは対象外）。

### §10-4 フック（commit / push の門）との付き合い方 — 全エージェント共通
pre-commit / commit-msg / pre-push の門は git フックなので、どのエージェントで作業しても発火する。
- 迂回禁止: `--no-verify`・`SKIP=` は使わない。フックが落ちるなら迂回せず違反そのものを直す
  （Claude Code では技術的にもブロックされる — CLAUDE.md。他エージェントでは本規約が心得として
  効き、CI（GUARDRAILS.md §5）が最終防衛線として同じ検査を再実行する）。
- 未コミットの作業を消すコマンド（`git reset --hard`・`git clean -f`・広域 checkout/restore）を
  使わない: 消してよい変更なら先に `git stash` で退避する（Claude Code では dirty 時に
  技術的にもブロック — GUARDRAILS.md §2 作業消失ガード。`.git` の削除は常に禁止）。
- 自動修正系フックで落ちたら: 書き換えられたファイルを `git add` して同じコミットを再実行するだけ。
- `generate-structure` で落ちたら: `git add STRUCTURE.md` して再実行するだけ。
- 同じフックが**2回連続**で落ちたら機械的リトライをやめて原因調査に切り替える。

## §11 既知の制約
- `chrome.storage.local` はクォータ 10MB（Manifest V3・無制限化オプション未使用時）。
  `chrome.storage.sync` を使う場合は 100KB 総量・1アイテム8KB制限に注意（本プロジェクトは
  現状 `local` のみを使用——`src/lib/storage.ts` のシームに集約されているため、将来
  `sync` へ切り替える場合の変更点は1ファイルに閉じる）。
- 拡張機能の E2E テスト（Playwright）は headless では動作しないため headed 実行が必須
  （CI では `xvfb-run` を使う — bindings/catalog.md ts-react-crx@1）。

## §12 作業開始の定型手順
1. `STRUCTURE.md` を読む（いまの全体像）
2. 技術選定文書 `docs/stack.md` を読む（なぜこの構成か）
3. 触るフォルダの `CLAUDE.md` を読む（フォルダ固有の知見・ハマりどころ）
4. 環境が要る作業なら `uv run scripts/dev.py verbs` で配線状態を確認する
   （未配線の動詞に当たったら GUARDRAILS.md §12.1——黙って回避しない）

## §13 発見の記録先（中央メモは作らない）
- 再現できるバグ → 回帰テスト（fix と同一コミット）
- 直感に反する箇所 → その場の近接コメント
- フォルダ固有の知見 → そのフォルダの `CLAUDE.md`
- **昇格ルール**: 近接コメントに書いた制約が、そのファイルの**外**（＝別ファイルの
  テストやコードを書く場面）で噛んだら、そのフォルダの `CLAUDE.md` へ昇格する
  （例: `tokenize.ts` のヘッダーコメントに書いてあったCJKトークナイズの制約を知らずに
  別ファイルの検索テストを書いて壊した、という失敗の型を塞ぐ）。全フォルダへの
  `CLAUDE.md` 新設は義務にしない——踏んでもいない知見を先回りして書くと空のボイラー
  プレートが増え、読む価値が薄まる（偽陽性 > 価値）。
