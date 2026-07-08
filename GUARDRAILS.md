# GUARDRAILS.md — LLMの作業出戻りを防ぐ仕組みの全体マップ

> **このファイルの役割**: リポジトリ全体に散らばっている「出戻り防止機構」
> （Claude Codeフック・pre-commit・CI・CLAUDE.mdの各種規則）を1箇所から見渡せるように
> した集約ビュー。**実装済み（✅）の機構については正本はこのファイルではない**——
> 各セクション末尾に挙げた実ファイルが常に最新かつ正しい。
>
> **実装状態の記号**:
> - ✅ = 実装済み。正本は実ファイル。本書は契約（呼び出し方・終了コード・保証）と所在のみ書く。
> - 🚧 = 未実装（契約のみ）。**コードが存在するまで、本書の該当節が唯一の正本**。
>   実装したら同一コミットで ✅ に更新する。実装順と完成条件は §10 のロードマップが正本。
>
> **本書が書いてよい範囲は「契約」まで**。各機構の *呼び出し方・終了コード・入出力・
> 保証すること*（＝インターフェース）は本書が規定する。*実装の中身*（正規表現の細部・
> 処理順など）は各スクリプト本体とその先頭ヘッダーコメントが正本であり、本書へは複製
> しない。契約と実装の食い違いを見つけたら、**同一コミットで両方を直す**。
>
> **ゲートは「わざと違反して落ちる」のを見届けて初めて完成**。fail-open（形だけ動いて
> 実は素通し）は静かに守りが消える最悪の欠陥——例: PreToolUse フックは exit 2 **以外**の
> 非0では何もブロックしない（§2）。だから §10 の全 Phase と §11 の全 Step の完成条件
> （DoD）には**違反注入テスト**を必ず含める。
>
> 本書は「言語非依存の契約（§1〜§9・§12）」と「言語固有の穴埋め」を分離してある。
> **穴埋めの正本は `bindings/catalog.md` の検証済み列**（運用は §12.7）——本書の中に
> 具象コマンド・正規表現が例として現れる場合、それは移植元の参照値であって正本ではない。
> この仕組み全体の**目標の正本は `GOALS.md`（G1〜G14）**——本書・キット・カタログへの
> 変更は、どのGに効くかを引用して初めて入れられる。
> **新規リポジトリへの移植は §11 のブートストラップ手順**で行う。
>
> 出戻り（rework）＝「後工程（コミット・push・CI）で初めて違反が見つかり、直してから
> 同じ作業をやり直す」こと。この仕組み全体の狙いは、違反の発見をできるだけ**前工程**へ
> 前倒しすること。

## 0. 全体像（タイミング × 検査 × 正本）

```
Edit/Write ─▶ [§1 整形→lint] ─▶ git commit ─▶ [§3 検査] ─▶ git push ─▶ [§4 検査+テスト] ─▶ CI [§5 全再実行+拡張]
                      （どの段の迂回も §2 が横断的にブロックする）
（この静的工程と直交して、開発ループ中は §12 のランタイム契約——共通動詞・操作/観察レール——が常時ある）
```

| タイミング | 何が動くか（節） | 自動修正 | 迂回可否 | 正本 |
|---|---|---|---|---|
| 編集直後（Edit/Write/MultiEdit） | 採用列の整形→単一ファイル lint の**直列2段**（§1・v2.5） | 整形○／lint× | — | `.claude/settings.json`・`.claude/hooks/post_edit_format.py`・`post_edit_lint.py` |
| `git commit` 時 | 衛生＋秘密検出＋STRUCTURE.md鮮度＋構造検査＋メッセージ検査（§3） | 一部○ | 禁止（§2で技術的にブロック） | `.pre-commit-config.yaml` |
| `git push` 時 | テスト＋静的解析（列充填）＋ブリッジ鮮度🚧（§4） | × | 禁止（§2） | `.pre-commit-config.yaml` |
| CI（PR・main push） | 上記すべて再実行＋E2E（列充填）＋red-first 証明（PR のみ・列充填・required — v2.9）＋カバレッジ計測🚧（§5） | × | 不可（リポジトリ側で強制） | `.github/workflows/guardrails-ci.yml` |
| ターン終了（Stop） | 未完了終了の差し戻しゲート（§2b。条件A=未コミット作業・条件B=構造検査が赤 — v2.9）——実行規律7の機械化 | × | —（fail-open＋回数上限） | `.claude/settings.json`・`.claude/hooks/stop_incomplete_guard.py` |
| セッション開始→編集直前（SessionStart + PreToolUse Edit/Write/MultiEdit） | 所有権ガード（§2c・v2.6）——人間の未コミット変更の上書き防止 | × | —（fail-open＋表示） | `.claude/settings.json`・`.claude/hooks/session_baseline.py`・`guard_human_wip.py` |
| 開発ループ中（実行時） | 共通動詞 `dev.py`・操作/観察レール（§12） | — | —（未配線は明示エラー） | `scripts/dev.py`・`bindings/catalog.md` |

前工程に行くほど検査が軽く・速く、後工程に行くほど重く・広くなる設計
（`.pre-commit-config.yaml` 冒頭のコメント参照）。**各機構の実装状態の一覧は §10 の状態表が正本**。
外部語彙との対応: 世間のガイドで言う「Fail Loudly（静かに壊れず、派手に失敗して止まる）」は、
本キットでは §1 の exit 2 フィードバック・§2/§2b の fail-closed / fail-open 契約・§12.1 の
未配線明示エラーとして**実装済みの機構の別名**であり、新規項目ではない。

**初回セットアップ**: ① uv を公式インストーラで導入（マシンに1回） ②
`uv tool install pre-commit` ③ リポジトリで `pre-commit install` を1回実行。
以降、Python 系の実行・導入はすべて uv 経由（§7.1）。
`default_install_hook_types`（現在: `[pre-commit, commit-msg, pre-push]`）
に列挙されたフック種がまとめて入る。**フック種を増やしたら `pre-commit install` の再実行が必須**
——忘れると新フックは*静かに*無効なまま（fail-openの一種）。この取りこぼしは
§3.3 の `hook-type-missing`（hard）が機械検出する（心得を検査に変換 — G7/G9）。

**落ちた時の一次対応**（考え方の正本はルート `AGENTS.md` §10-4）:

| 症状 | 一次対応 |
|---|---|
| 衛生チェックで落ちた（§3.1） | 書き換えられたファイルを `git add` → 同じコミットを再実行 |
| gitleaks で落ちた（§3.1） | 本物の秘密→ファイルから除去して再実行（コミット前に止まるので履歴は無傷）。偽陽性→当該行に `gitleaks:allow` コメントを付けて再実行 |
| `generate-structure` で落ちた（§3.2） | `git add STRUCTURE.md` → 同じコミットを再実行 |
| `check-structure` の hard で落ちた（§3.3） | 出力の規則IDで §3.3 を引き、違反そのものを解消（自動修正はない） |
| `hook-type-missing` で落ちた（§3.3） | `pre-commit install` を再実行するだけ（フック種追加後の入れ忘れ） |
| `hooks-path-overridden` で落ちた（§3.3） | ユーザーの端末で `git config --unset core.hooksPath`（Claude Code からの解除は §2 がブロックするため人間の操作） |
| `guard-corpus-mismatch` で落ちた（§2） | 門番の改修が過去に塞いだ迂回を開け直している。guard 本体とコーパスの期待値を**同一コミット**で揃える（期待値の書き換えだけで黙らせない） |
| 編集直後 lint（§1 第2段）で exit 2 | stderr の指摘を**その場で**直す（次の編集で自動再検査）。「lint 未導入」表示は素通し＝push 段で回収される合図 |
| コミットメッセージ検査で落ちた（§3.4） | 形式を直す。「テスト無しの fix」なら回帰テストを同梱するか、テストで再現できない修正なら fix でなく chore/refactor を名乗る |
| `undeclared-dependency` で落ちた（§3.4 検査4） | 意図した追加なら本文に `依存追加: <名前> — 理由1行` を書いて再実行。意図しない追加（コピペ・ツールの副作用）ならマニフェストから外す |
| 作業消失ガードでブロックされた（§2） | 消してよい変更なら先に `git stash`（または commit）で退避してから再実行——クリーンなツリーでは同じコマンドが素通しになる。`.git` を消す操作は常時ブロック（人間の指示なら人間の端末で） |
| `deprecated-api` で落ちた（§3.3） | ラベルが示す**現行 API へ置き換える**（旧作法へ戻さない）。パターンの根拠・代替は採用列のカタログ注記——値を変えるなら版上げで還元（§12.7） |
| 所有権ガードでブロックされた（§2c） | セッション開始時点から**人間の**未コミット変更があるファイル。人間が commit / stash すれば自動解除（AI 側からの退避コマンドは §2 が別途ブロック——人間の操作を待つ） |
| `feat-without-plan` で落ちた（§3.4 検査5） | レイヤー直下に新規ディレクトリを作る feat: に設計根拠の差分が無い。根拠（1行でよい）を `plan.md` / `docs/plans/` に書いて同コミットへ含める。根拠を書けない構造変更なら feat でなく refactor / chore を名乗る（v2.8 で hard 昇格＝G14「意図の保存」——決定点①は案Aで確定 §10 Phase 19） |
| `red-first-green` でジョブが赤（§5） | 同梱テストが親コミットでも緑＝バグを再現していない。親で赤になるテストに直す。CI 上で赤にできない修正なら本文に `RED-FIRST-EXEMPT: 理由` を書く（**理由必須**——空は免除不成立。乱用はレビューで点検 — ルート AGENTS.md §8。v2.9 で required に確定） |
| `bootstrap-*` で落ちた（§3.5） | `false-done` = ✅ の主張が再実行検証に落ちた——状態を 🚧 に戻して再実装（完了=実行結果）。`order` / `multi-flip` = 番号順に1コミット1Stepで ✅ 化し直す。`demote` = ✅→— は禁止・やり直しは ✅→🚧。台帳の書式は BOOTSTRAP.md 冒頭の注記 |
| `mcp-not-allowed` で落ちた（§3.3） | `.mcp.json` に採用許可リスト外の MCP がある。常駐が本当に必要ならカタログの「MCP・エコシステム採用規律」（ゲート3条: 重複排除・常駐予算・契約整合）を通し、判定を記録して `MCP_ALLOWED_SERVERS` へ追加（2026-07-07 調査の再判定＝版上げ）。スポット用途なら `.mcp.json` に入れず `claude mcp add/remove` のタスク単位運用にする（§12.4） |
| Claude Code 以外のエージェント（Codex / Cline 等）で作業する | 規約の正本はルート `AGENTS.md`（ネイティブ直読み — §6）。commit / push / CI の門は git フックなので同じに効く。編集直後・操作直前・ターン終了のフック層（§1/§2/§2b/§2c）だけは Claude Code 限定＝AGENTS.md §10-4 の心得と CI が代役 |
| ターン終了が差し戻された（§2b） | stderr の理由を見る: 未コミット作業（条件A）なら DoD を満たしてコミット、構造検査が赤（条件B — v2.9）なら文面の規則IDで §3.3 を引いて解消しコミット。物理的ブロッカーなら応答の先頭を `BLOCKED:` で始めて具体的に報告する |
| pre-push のテスト・analyze・clippy で落ちた（§4） | 違反を直す（`allow` / `ignore` の乱発で黙らせない） |
| ブリッジ鮮度で落ちた（§4）🚧 | 再生成された生成物をコミットに含めてから再 push |
| `dev.py` の動詞が「未配線」で落ちた | `bindings/catalog.md` の採用列の値を `scripts/dev.py` の COMMANDS へ充填（§12.1） |
| 同じフックが **2回連続** で落ちた | 機械的リトライをやめて原因調査に切り替える |

---

## 1. 編集直後（Claude Code PostToolUse フック）✅ — 整形→lint の直列2段（v2.5 で第2段を追加）

- **`.claude/hooks/post_edit_format.py`（第1段・自動修正系。v2.24でPython化）** — Edit/Write/MultiEditの直後に走る。対象判定は
  編集されたファイルパスの拡張子 → `DISPATCH` 辞書引きで行い、**採用列の整形コマンド**を
  その場で当てる（`DISPATCH` の中身は `bindings/catalog.md` の paste-block を Step 0 で
  充填。整形は冪等であること。直接バイナリを叩く——npx/uvx 経由は避ける・§7.7）。
- **`.claude/hooks/post_edit_lint.py`（第2段・判定系 — Phase 12。v2.24でPython化）** — 整形の直後、同じ編集
  ファイルへ**単一ファイル lint** を当てる。違反は exit 2（stderr が Claude に渡る）——lint の
  初出地点が push 段（§4）から編集直後へ2段前倒しになり、「push で落ちて再試行」のループ
  1周が消える。責務境界: `--fix` 系（自動修正）は第1段の仕事、ここは判定のみ。全体
  typecheck・全体テストはここに入れない（§4 に残す——予算は下記）。ツール未導入・実行
  不能（eslint の設定不足等）は **stderr 1行の表示＋素通し**（exit 0。表示で「静かな不発」
  を防ぎつつ編集フローは止めない——ゲートではないこの層の fail-open 側の整理）。
- **実行順の保証（実装時確定 — Phase 12）**: Claude Code の公式仕様では**同一 matcher に
  複数フックを並べると並列・順序不定**。そのため2エントリ登録ではなく、`settings.json` の
  PostToolUse を「stdin を保持して整形→lint を順に呼ぶ **1コマンドの直列**」として配線する
  （整形が非0ならその exit で短絡・lint の exit 2 はそのまま伝播——実測で確認済み）。
  これにより順序が実行環境の仕様変更に依存しない。
- **狙い**: フォーマット崩れ・lint 違反の検出地点を「コミット時/push時」から「編集した瞬間」へ
  前倒しする。これが効いていれば後段のフォーマットチェックはほぼ常に素通りし、
  「コミットが落ちて再試行」というループ1周分が丸ごと消える。
- **終了コードの意味（Claude Code の仕様）**: PostToolUse はツール実行「後」に走るため
  編集自体は取り消せない。exit 2 のとき stderr が Claude に渡され自己修正の材料になる。
  それ以外の非0は非ブロッキング（表示のみで続行）。
- **性能予算**: 整形＋lint 合計で**編集1回あたり3秒以内**（§7.7・v2.5 新設）。予算に
  収まらない言語の lint は「該当なし（push 段で回収）」としてカタログに判断を記録する
  （dart-flutter@4・rust@4 がその例）。
- 正本: `.claude/settings.json` の `hooks.PostToolUse`（直列1コマンド）とスクリプト本体2つ。

## 2. 迂回防止（Claude Code PreToolUse フック + permissions）✅ — 横断的な防壁

出戻り防止の各種チェックは「迂回されたら意味がない」ため、迂回そのものを二重に塞ぐ。

- **`.claude/hooks/guard_git_bypass.py`**（PreToolUse: Bash・v2.23 で Python 化 — §7.7 Phase 33） — 実行されようとする Bash
  コマンド文字列に対し、`git commit`/`git push` で `--no-verify`（結合短フラグ含む別名 `-n` も）
  または `SKIP=` を伴うもの、`git push` の `--force`/`-f`（`--force-with-lease` 含む）、
  `core.hooksPath` の付け替え（フック本体の差し替え＝全フック迂回）、および
  `pre-commit uninstall`（シムの取り外し。`uvx` 経由や `cd x && …` を含む）を **exit 2** で
  ブロックする。v2.5 からは**作業消失ガード**（下記——非可逆な作業消失の防止）も同じ
  フック内の節として持つ（プロセス数を増やさない — G11）。deny（下記）は前方一致のみなので、**引数順・経由を変えた迂回を塞ぐのは本フックの責務**。引用符の中身（コミットメッセージ等）は判定前に
  取り除くため、メッセージ文面に `--no-verify` という文字列が入っていても誤検知しない。
- **PreToolUse の終了コード仕様（重要）**: ブロックするのは **exit 2 だけ**。exit 1 を
  含むその他の非0は「非ブロッキングエラー」でツールは実行されてしまう（fail-open）。
  したがってこのフック内の想定外エラーも exit 2 に倒す（fail-closed）ことが契約。
- **`.claude/settings.json` の `permissions.deny`** — 上記フックが万一漏れた場合の
  二重の防壁。`--no-verify` 付き commit/push・`--force` push・`core.hooksPath` の変更・
  `pre-commit uninstall`・`STRUCTURE.md` への直接 Edit/Write/MultiEdit を拒否する。
  🚧 Phase 6 で flutter_rust_bridge の生成物への直接 Edit/Write も追加する（§4）。
- 本節が塞ぐのは「迂回する操作」。**既に迂回された状態**（core.hooksPath が設定済み・
  シム未インストール）は §3.3 の `hooks-path-overridden` / `hook-type-missing` /
  `hooks-not-installed` が静的に検出する（操作の防壁と状態の検査で挟む — G7/G9）。
- **原則**: 「生成物は生成スクリプトだけが書く」。`STRUCTURE.md` を書いてよい主体は
  `scripts/generate_structure.py`（Bash ツール経由）のみ（§7）。
- ✅ **guard 迂回コーパス**（v2.4 — G10/G7/G11）: 主防壁の回帰テスト。
  `tests/guard_corpus.tsv`（1行 = `期待<TAB>コマンド` または `期待<TAB>前提<TAB>コマンド`・
  期待 ∈ DENY/ALLOW・前提 ∈ dirty/clean。空行・コメント行・書式不正は内部エラー＝
  コーパスが黙って痩せない）を
  `scripts/check_guard_corpus.py` が再生する——各行を PreToolUse と同じ形
  （`{"tool_input":{"command":…}}` の stdin JSON）で guard へ流し、exit 2=DENY /
  0=ALLOW を期待と照合。不一致は `HARD:guard-corpus-mismatch 行N: 期待X 実際Y: <cmd>`
  の1違反1行・exit 1、内部エラーは exit 2。**前提列（v2.5・Phase 14）**: 作業消失ガードの
  dirty 条件付き規則を再生するための列。前提付きの行は一時 git リポジトリ（dirty=未コミット
  変更あり / clean=変更なし）をカレントにして guard を呼ぶ——このとき外側の `GIT_*` 環境
  （フック実行中の git が設定する）と `CLAUDE_PROJECT_DIR` はフィクスチャ側へ差し替える
  （外のリポジトリ状態に判定が依存しない）。前提行が1行でもあれば git も必須になる。
  **期待値は精密経路（引用符除去）前提のため jq 必須**（bash とともに不在は明示エラー
  ——§7.2 の流儀）。pre-commit では `files:` で
  門番3点（guard・コーパス・チェッカ）に限定して配線＝通常コミットでは走らず、門番に
  触れた時だけ回る。CI の `--all-files` では常時回る（二重の網）。門番の改修が過去に
  塞いだ迂回を静かに開け直す事故（門番自身の回帰）を、fix⇔テスト（G10）と同じ複利の
  型で機械停止する。予算: 全行10秒以内（§7.7・v2.22で実測是正）。
- ✅ **作業消失ガード**（v2.5・Phase 14 — G7/G9/G10）: 迂回とは別種の「exit 2 で止める
  価値が確実な操作」＝**非可逆な作業消失**を同じ主防壁で塞ぐ。汎用の「危険コマンド一覧」
  は採らない（誤検知の密集地帯——§7.4「近似は仕様」の精神で、確実な2種だけを対象にする）。
  - **常時ブロック**: `.git` を含む `rm -rf`（結合フラグ `-rf`/`-fr`/`-Rf` 等の近似。
    リポジトリ履歴＝全作業の非可逆な破壊。履歴ごと消えれば §2〜§5 の全機構も無力）。
    引用符で包んだ `.git` は精密経路の除去で消えるため、生コマンド側の引用付きトークンも
    併せて見る（過剰ブロック側）。分離フラグ `rm -r -f` は近似の範囲外——実測されたら
    コーパスと同一コミットで還元する。`.github` 等は語境界で除外済み。
  - **dirty 条件付きブロック**: `git status --porcelain` が非空（未コミットの作業がある）
    **かつ**それを消すコマンド——`reset --hard`・`clean` の force（`--force`/短フラグ `-f`）・
    広域の `checkout .` / `restore .`（`.` は当該サブコマンドの後の単独トークンのみ＝
    `git add .` 等では発火しない。`restore --staged .` はインデックス操作のみで作業ツリー
    無傷のため対象外、`--worktree`/`-W` を伴えば対象）——のとき exit 2。**クリーンなら
    同じコマンドは無害なので素通し**（dirty 条件が誤検知をほぼ消す）。status の判定不能
    （git 不在・リポジトリ外）はブロック側に倒す（fail-closed — 本節の契約）。
  - 対象外の境界: ローカルDBの破壊は対象外（`reset` 1発で戻る設計が §12.2 の前提——
    可逆）。ブランチ切替・ファイル単位の restore・`stash`・`clean -n` は正規経路として素通し。
  - ブロック文面は迂回系と区別した専用文（`block_loss`）: 退避の正規経路（commit/stash）と
    「人間の指示なら人間の端末で」を案内する。
- ✅ **probe（事前照会）**（v2.4 — G4/G12/G2）: 「このコマンドは許可されるか」を実行前に
  1コマンドで照会する: `uv run scripts/dev.py probe "<cmd>"`（§12.1 の第10動詞。実体は
  `check_guard_corpus.py --probe`）。出力は `ALLOW`（exit 0）または
  `DENY guard: <ブロック理由>`（exit 1）、exit 2 は内部エラーに予約。コーパス再生と
  **同一経路**で guard を呼ぶため、probe の判定 = 実際の PreToolUse の判定（LLM の
  「試して exit 2 で怒られる」1周を削る）。
- **外部裏書き（v2.4 注記）**: ① `permissions.deny` の不動作報告（`.env` への Read deny が
  無視される等）が外部で複数実測されており、「deny は前方一致の第二防壁・主防壁はフック」
  という本節の二重構造の設計判断を裏書きする。② CLAUDE.md の規則は公式に「影響であって
  強制ではない」とされ、プロンプト注入で上書きされた攻撃事例も報告されている——門を
  CLAUDE.md（心得）ではなくフック・検査側に置く本キットの構造の外部裏書き。
- 正本: `.claude/settings.json`・スクリプト本体・`tests/guard_corpus.tsv`・
  `scripts/check_guard_corpus.py`。

## 2b. ターン終了ゲート（Claude Code Stop フック）✅ — 実行規律7の機械化（v2.4）

§10 実行規律7「途中でターンを終えない」はキットで唯一、心得のまま残っていた規律
だった。本節がそれを門に昇格させる（枝番は Step 8b の前例——§3 以降の番号参照を壊さない）。

- **`.claude/hooks/stop_incomplete_guard.py`**（`settings.json` の `hooks.Stop`。v2.24でPython化）——
  応答終了時に発火し、**exit 2 で終了を差し戻す**（stderr が Claude に渡り、続行の
  指示になる）。差し戻し条件（**いずれかの理由 ∧ 免除なし** の時のみ）:
  **条件A（v2.4）** `git status --porcelain` が非空（未コミットの作業がある）。
  **条件B（v2.9・決定点②の強化案を確定 — Phase 20）** ツリーはクリーンだが
  `dev.py check` が exit 1 かつ出力に `HARD:`——「クリーンにさえすれば赤い検査を
  残して終われる」隙間（条件A単独の残余）を塞ぐ。
  **免除（両条件共通）** transcript 終端 50 行に `BLOCKED:` で**始まる**報告がある。
  これで規律7の正規出口——(a) DoD を満たしコミット済み**かつ**構造検査が緑、
  (b) 物理的ブロッカーの具体的報告（応答の先頭を `BLOCKED:` で始める）——だけが
  終了経路になる。
- **条件Bの縮退と性能（fail-open は本節契約の適用）**: 条件Bはクリーンな時だけ走る
  （ダーティなら条件Aが先に成立——毎ターンのコストは §7.7 の 2 秒予算＋uv 起動数十ms）。
  uv 不在・`scripts/dev.py` 不在は**表示1行で条件Aのみへ縮退**（静かな不発の禁止は
  表示で満たす——§2c と同じ整理）。check の exit 2（内部エラー）・`HARD:` 行の無い
  非0 は差し戻さない。ハングは Claude Code 本体のフックタイムアウトが殺す
  （kill = exit 2 以外 → 差し戻されない側に倒れる）。差し戻し文面には `HARD:` の
  先頭5行を同梱する（規則IDから §3.3 へ直行できる — G4）。
- **判定「免除」は先頭一致の近似（仕様——§7.4 の流儀）**: transcript の JSONL に対して
  `"BLOCKED:`（値の先頭）を探す。素の `BLOCKED:` を探すと、本フック自身の差し戻し文面
  （`BLOCKED:` の指示を含む）が transcript に載った時点で恒久すり抜けになるため。
- **ループ保護（二重・条件A/Bで共有）**: ① 入力 JSON の `stop_hook_active=true`（既に差し戻しで継続中）
  のとき、`.claude/session/<session_id>.stopcount` のカウンタで差し戻しを**最大3回**に
  制限（新しい停止連鎖＝`stop_hook_active=false` で数え直し。正規終了でカウンタ削除。
  `.claude/session/` は .gitignore 済み——追跡すると porcelain が恒常非空になり
  ゲートが誤発火する）。② Claude Code 本体側にも連続ブロックの安全上限がある
  （v2.1.143+・`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` で調整可）。
- **【契約の非対称——§2 と対で読む】** 本フックの想定外エラー（git 不在・transcript
  読取不能・カウンタ書込不能・JSON 不正等）は **exit 0（fail-open・差し戻さない）**。
  PreToolUse（§2）は fail-closed が正だが、Stop で fail-closed にすると壊れたフックが
  **セッションを終了不能にする**。まとめ: **§2 = fail-closed ／ §2b = fail-open ＋
  回数上限**。この向きの違いこそが両節の契約の核心であり、DoD の違反注入も逆向きに行う
  （§2 は「エラーでもブロックされる」を、§2b は「エラーでも通る」を実測する）。
- Claude Code **外**の環境（生の API・他エージェント）では本ゲートは無く、
  §10 実行規律7 が引き続き心得として効く（規律の文言は §10 に残置）。
- 決定点②は v2.9 で強化案（条件B）に確定——記録と DoD は §10 Phase 20。
- 正本: `.claude/settings.json` の `hooks.Stop` とスクリプト本体。

## 2c. 所有権ガード（SessionStart + PreToolUse フック）✅ — 人間の未コミット変更を AI が上書きしない（v2.6）

人間と AI の変更が**同じファイルの同じ diff に混ざる**と、原因追跡（どちらの変更がバグを
入れたか）が構造的に不能になる。本節はセッション開始時点で既に dirty だったファイル
（＝人間の WIP）への AI の Edit/Write を物理的にブロックする。

- **`.claude/hooks/session_baseline.py`**（`hooks.SessionStart`。v2.24でPython化）——セッション開始時点の
  `git status --porcelain` のパス集合（未追跡 `??` を含む——人間の新規ファイルも WIP）を
  `.claude/session/<session_id>.baseline` へ保存する（1行1パス・リポジトリ相対。
  クリーン開始でも**空の baseline を必ず書く**——「不在（不明）」と「開始時クリーン
  （保護対象なし）」を後段が区別できるようにする）。SessionStart は exit 2 でも
  セッションを止めない仕様のため、保存失敗は stderr 1行の表示のみで進行する。
- **`.claude/hooks/guard_human_wip.py`**（PreToolUse: `Edit|Write|MultiEdit`）——ブロック
  条件は**両方**成立の時のみ: (A) 対象 `file_path` が baseline に含まれる、かつ
  (B) そのファイルが**現在も**未コミット。人間が commit / stash すれば (B) が外れて
  **自動解除**——解除用の特別経路を作らない。パスの正規化（絶対→相対・区切り差）は
  `git status --porcelain -- <path>` の出力がリポジトリ相対で返ることを利用して git に
  任せる（§7.2 の Windows 罠を自前で踏まない）。
- **対の完成（Phase 14 → 16）**: §2 の作業消失ガード（自分・人間の WIP を**消せない**）と
  本節（人間の WIP を**上書きしない**）で、「未コミット作業の保全」が消失・混入の両面から
  塞がれた。AI がブロックを退避コマンド（`reset --hard` 等）で回避しようとしても、
  dirty ツリーでは §2 が先にブロックする——二つの門は互いの逃げ道を塞ぐ配置。
- **【契約——§2b の仲間・§2 と逆向き】** baseline 不在（SessionStart 未発火・保存失敗）・
  git 不在などの想定外は**警告1行＋exit 0（fail-open）**。書き込み保護は利便との
  トレードであり、壊れたフックが全編集を止めてはならない。まとめ: **§2 = fail-closed ／
  §2b・§2c = fail-open ＋ 表示**（静かな不発の禁止は表示で満たす）。DoD の違反注入も
  §2b と同じく逆向きに行う（「エラーでも通る」を実測する）。
- **既知の限界（仕様）**: baseline はセッション**開始時点**のスナップショット。同一
  セッション内で人間が並行して編集を始めたファイルは守れない。porcelain のリネーム行は
  両側のパスを保存する近似・`core.quotePath` の引用表記（非 ASCII パス等）は近似の
  範囲外（§7.4「近似は仕様」——実測されたら両フックを同一コミットで直す）。
- guard_human_wip.py は §2 のコーパス再生の**対象外**（別フック・baseline という状態を
  持つ）。回帰は Step 4 の違反注入 DoD が担保し、コーパス化は §10 の保留に登録済み。
- 正本: `.claude/settings.json` の `hooks.SessionStart` / `hooks.PreToolUse`
  （`Edit|Write|MultiEdit`）とスクリプト本体2つ。`.claude/session/` は .gitignore 済み（§2b と共用）。

## 3. コミット時（pre-commit）

`.pre-commit-config.yaml` が正本。導入は §0 の初回セットアップ1回のみ。

### 3.1 衛生チェック（自動修正あり）✅ ＋ 秘密検出 ✅
- ✅ `trailing-whitespace` / `end-of-file-fixer` / `check-added-large-files`（1MB上限）/
  `check-yaml` / `check-toml` / `check-merge-conflict`——いずれも
  `pre-commit/pre-commit-hooks` の既製フック。**落ちてもファイルが書き換えられている
  だけなので、そのファイルを `git add` して同じコミットを再実行すれば通る**。
- ✅ **gitleaks**: 公式 pre-commit フック（`repo: https://github.com/gitleaks/gitleaks`、
  `rev` は固定して更新はコミットで行う）。ステージ済み差分から トークン・APIキー・秘密鍵の
  パターンを検出して exit 非0。**コミット前に止めることが最大の価値**——一度 push された
  秘密は履歴書き換え＋鍵ローテーションという最悪級の出戻りになる。偽陽性の許容は
  当該行への `gitleaks:allow` インラインコメントで行単位・目に見える形に限る
  （設定ファイルでのパス丸ごと除外は原則しない）。ルート `AGENTS.md` §7「秘匿」の
  コミット面を機械化するもの。ログ出力面の対策は §8。

### 3.2 STRUCTURE.md鮮度確認（`generate-structure`）✅（Python/uv 版）
`scripts/generate_structure.py`（**契約は §7**）が
実ファイル・実シンボルから `STRUCTURE.md` を毎回再生成する。内容に差分が出た場合、
pre-commit の「フックがファイルを変更したら失敗扱い」機構（§7.6）により **1回だけ**
失敗する（＝鮮度確認）。対応は `git add STRUCTURE.md` → 同じコミットを再実行、のみ。
**`STRUCTURE.md` は生成物なので手で編集してはいけない**（§2 の deny で技術的にも
ブロック済み）。

### 3.3 構造検査（`check-structure`）✅（Python/uv 版）
`scripts/check_structure.py` が実行する（契約は §7）。検査器はすべて同梱済みで、
（列充填で有効化）と付く規則は採用列のパターン充填（Step 0〜）により発火する。
**hard 違反が1つでもあれば exit 1**（コミット停止）、**soft は stderr に警告を出す
だけで exit 0**。自動修正はしない。出力は **1違反1行・先頭に規則ID**
（例: `HARD:layer-violation app/lib/x.dart:12 説明…`）——LLM が機械的に本書と
突き合わせて直せる形式にする。検出パターンの実体はスクリプトが正本、
**「何を検査するか」の一覧は本節が契約**。

**hard（exit 1・コミット自体を止める）**:
- （列充填で有効化）`layer-violation` — レイヤー違反（表Bの LAYER_FORBIDDEN_IMPORTS が定義。移植元の例: `app/` が `engine/` を直接import、または `engine/` が `app/` を参照）
- ✅ `missing-required` — 必須ディレクトリ・必須ファイルの欠落（正本4文書＋規約2文書（AGENTS.md / CLAUDE.md — §6）に加え、
  防壁の実体——`BOOTSTRAP.md`（台帳 — §3.5）・`.pre-commit-config.yaml`・`.claude/` のフック6本と settings・`guardrails-ci.yml`・
  `scripts/` 9本・`tests/guard_corpus.tsv`・`.gitattributes`・`.python-version`——自体も
  対象。防壁が消える＝静かな fail-open の最悪形 — G7/G9）
- ✅ `agents-import-missing` — CLAUDE.md 冒頭の `@AGENTS.md` インポート行の欠落（v2.10・
  Phase 22。規約の正本は AGENTS.md——Claude Code はこの import 経由でのみ到達する。
  複製・同期スクリプトではなく「分割＋この存在検査」がドリフト防止の実体 — §6・G5）
  （`missing-required`(AGENTS.md/CLAUDE.md)・本規則は**キット原本自身**（`.guardrails-kit-source`
  マーカー在中のチェックアウト）では SOFT に降格——導入先の Step 1 未着手と構造上
  区別不能なため、配布物に複製されないマーカーで明示判定する。v2.14・Phase 27）
- ✅ `mcp-not-allowed` — プロジェクト正本（追跡された `.mcp.json`——basename 一致）に
  採用許可リスト（`repo_scan.py` の `MCP_ALLOWED_SERVERS`——中立既定値は playwright のみ
  ＝**2026-07-07 の MCP・エコシステム調査の判定**）外の MCP サーバーがある（v2.11・
  Phase 23。1サーバー1行。追加はカタログの「MCP・エコシステム採用規律」ゲート3条を
  通し判定を記録してから——G3/G5/G7。解釈不能な JSON は `SOFT:mcp-unparseable` で素通し。
  タスク単位のローカル追加（`claude mcp add`——保留の運用形）は追跡外＝対象外）
- ✅ `context-doc-too-large`（**soft**） — 常時読込の規約文書（ルート/フォルダ CLAUDE.md
  =200行・AGENTS.md=500行が中立既定。`repo_scan.py` の `CONTEXT_DOC_LIMITS`——列上書き可）
  の行数超過を警告（v2.17・Phase 28・調査③）。常時読込の行数はそのまま常駐コンテキスト
  （G3）。soft の理由: 正当に育つ文書であり、分割の判断は人間。この警告は **Skills 化
  保留（§10）のトリガー「常駐が問題化した実測」のセンサー**を兼ねる。
- ✅ `env-file-tracked` — 実値の入り得る `.env` 系ファイルの追跡を拒否（v2.18・Phase 29・
  調査④）。gitleaks（§3.1）は**内容**のパターン検査＝低エントロピーの実値は素通りし得る
  ため、**存在自体**を hard で塞ぐ。雛形（`.env.example` / `.env.sample` / `.env.template`
  ——`repo_scan.py` の `ENV_FILE_ALLOWED`・列 += 可）は除外。解消は `git rm --cached`
  ＋ .gitignore 追記＋**値は漏えい扱いでローテーション**。
- （列充填で有効化）`missing-log-coverage`（**soft**） — I/O・外部呼び出し・エラーハンドラ
  境界（`LOG_BOUNDARY_PATTERNS`——列充填。空なら不発）の前後 `LOG_BOUNDARY_WINDOW`
  行以内に、単一出口のログ呼び出し（`LOG_CALL_PATTERN`）か `NO-LOG: 理由` コメント
  （`NO_LOG_COMMENT_PATTERN`）のどちらも無い（v2.19・Phase 31・§8.4）。「重要度」は
  機械が判定できないため対象を客観的境界に絞り、理由の妥当性は検証しない存在検査のみ
  （RED-FIRST-EXEMPT と同じ「見えるようにするだけ」の境界 — G9）。
- （移植元の例）`missing-cxx-bridge` — cxxブリッジ（`cxx::bridge`）の欠落（この種の存在検査は REQUIRED_CONTENT_RULES として表B/列が定義する — §12.6）
- （列充填で有効化）`test-sleep` — テスト内の sleep 系（flakyの温床。移植元の例: `sleep` / `Future.delayed`。
  免除は `NONDETERMINISM-EXEMPT: 理由` コメント — §9.5・v2.25）
- （列充填で有効化）`test-nondeterminism` — テスト内の非決定入力（移植元の例: `DateTime.now()`・引数なし
  `Random()`・`thread_rng`・`SystemTime::now`。契約と代替手段は §9.2。免除は §9.5 と同じ）
- （表Bで確率的コンポーネント有の場合に有効化）`test-calls-solver-direct` — テストコードからのソルバー直呼び。
  テストは `solve_for_test` 相当のラッパー経由のみ（契約は §9.1）
- （列充填で有効化）`log-direct-call` — 採用列の単一出口以外での print 系直呼び
  （契約は §8.2。移植元の例: `lib/services/log.dart` 以外での `debugPrint` / `print`。
  `scripts/` は既定で除外——キット自身の出力契約（§3.3 の1違反1行・§12.1 の
  `[dev] 動詞:` 形式）が stdout/stderr 直書きを規定するため。除外の正本は
  `LOG_EXIT_PREFIXES`）
- （列充填で有効化。境界検査を持つ言語のみ）`missing-catch-unwind` — FFI 境界ファイルに `catch_unwind` が1つも無い
  （契約は §8.2）
- （列充填で有効化）`test-network` — テストファイル内の外部I/O直呼び（HTTP・生ソケット等。
  契約は §9.5、パターンは採用列が定義。免除は §9.5 と同じ `NONDETERMINISM-EXEMPT:`）
- （列充填で有効化）`deprecated-api` — 世代交代した旧 API の使用（v2.6・Phase 15）。
  LLM が訓練カットオフの都合で書きがちな旧作法（例: python の `datetime.utcnow(`）を、
  プロンプト規則（心得）でなく列パターン（門）で封鎖する。**テスト内限定でなく全コード
  走査**（旧作法はどこに書かれても旧作法）。パターンと出典規律（①ベンダー公式 AI
  プロンプト ②公式非推奨告知のみ初期値・近似不能な構文世代は載せない）の正本は採用列の
  カタログ注記。唯一の除外はパターン定義の正本ファイル `scripts/repo_scan.py` 自身——
  定義・ラベルは禁止対象の**引用**であって使用ではない（違反注入で実測した自己偽陽性。
  `LOG_EXIT_PREFIXES` が scripts/ を除外するのと同じ境界の引き方）
- （列充填で有効化）`ui-missing-testid` — UI操作要素にテストID属性が無い（契約は §12.4。
  対象ファイル・要素・属性の正規表現は採用列が定義）
- ✅ `binding-drift` — バインディング刻印 `BINDING-SOURCE: 列ID@版` が対象ファイル間で不一致
  （契約は §12.7。言語なしで常時有効）
- ✅ `hook-type-missing` — `default_install_hook_types` にあるフック種のシムが `.git/hooks` に
  一部だけ無い（install 再実行忘れ＝静かに無効、の機械検出 — §0。CI ではスキップ）
- ✅ `hooks-path-overridden` — `core.hooksPath` が設定されておりシムが無効（全防壁の静かな
  迂回の静的検出。解除はユーザー端末で `git config --unset core.hooksPath` — §2 参照）
- ✅ `binding-dead-pattern` — 充填したパターン辞書のキー拡張子が CODE_EXTS /
  HEADER_REQUIRED_EXTS に無く、その検査が永久に不発（列充填の取りこぼし＝fail-open の検出）

**soft（警告のみ・コミットは通る）**:
- ✅ 1ファイル500行超
- ✅ 1フォルダに `CLAUDE.md` 以外で7ファイル超（`scripts/` は例外で無制限）
- ✅ ファイル先頭の役割一行ヘッダー未記述・形式不正
- ✅ `app/CLAUDE.md` ・ `engine/CLAUDE.md` の欠落
- ✅ どこからも import/use・mod されない孤立ファイル（対象範囲・抽出器は採用列の
  `ORPHAN_UNIVERSES` / `IMPORT_TARGET_EXTRACTORS` が定義。O(N²) 実装の禁止——§7.3）
- ✅ `binding-unstamped` — バインディング刻印が未設定（Step 0 で採用列を刻印するまでの
  注意喚起 — §12.7）。刻印が**一部ファイルのみ**の状態は `HARD:binding-drift` になる
- ✅ `hooks-not-installed` — pre-commit のシムが1つも無い（出荷直後〜Step 3 前の正常状態。
  一部だけ無い状態は `HARD:hook-type-missing`。CI ではスキップ）

**出荷状態の想定出力**: v2キットを配置した直後の `check` は
`HARD:missing-required AGENTS.md`・`HARD:missing-required CLAUDE.md`・
`HARD:agents-import-missing`（いずれも雛形が `*.template` のため——Step 1 で解消）・
`SOFT:binding-unstamped`（Step 0 の刻印で解消）・`SOFT:hooks-not-installed`（Step 3 の
`pre-commit install` で解消）の**5件が出て exit 1 になるのが正常**。

**例外: キット原本自身のリポジトリ**（`.guardrails-kit-source` マーカー在中）は
Step 1 を未来永劫実行しない（実体化は導入先の仕事——原本は雛形のまま配布するのが正しい
状態）。上記5件のうち前3件は SOFT に降格されるため、原本リポジトリの `check` は
`SOFT:binding-unstamped`・`SOFT:hooks-not-installed`・`SOFT:missing-required`×2・
`SOFT:agents-import-missing` の**5件 SOFT で exit 0 になるのが正常**（Phase 27）。

### 3.4 コミットメッセージ検査（commit-msg ステージ）✅
`scripts/check_commit_msg.py`（§7.1・§7.2 の言語・Windows 規則に従う）。commit-msg
ステージのフックはコミットメッセージファイルのパスを引数1つで受け取る。
**導入時は `default_install_hook_types` に `commit-msg` を追加し、`pre-commit install` を
再実行すること**（§0 の注意——やらないと静かに無効）。

- **検査1（形式・`commit-msg-format`）**: ルート `AGENTS.md` §10 の規約
  `^(feat|fix|test|docs|refactor|chore): .+` に一致しなければ exit 1。
  `Merge` / `Revert` / `fixup!` / `squash!` で始まるものは素通し。
- **検査2（fix ⇔ 回帰テストの対・`fix-without-test`）**: メッセージが `fix:` で始まるとき、
  `git diff --cached --name-only` にテストのパス（`app/test/`・`app/integration_test/`・
  `engine/` 配下のテストファイル）が1つも無ければ exit 1。ルート `AGENTS.md` §8
  「一度直したバグは回帰テストに固定し fix と同コミット」の機械化。
  **逃げ道はプレフィックスの意味論で定義する**: テストで再現できない修正は
  fix ではなく chore / refactor / docs を名乗る。`SKIP=` は §2 が禁止している。
  なお同梱したテストが**親コミットで赤だった**か（＝バグを再現していたか）は commit
  段では検証できないため、CI の `red-first` ジョブが証明する（§5 — v2.7）。
  ステージ済み変更が**空**のとき（メッセージのみの `--amend` 等）は検査2〜4を素通しする
  ——`--no-verify` が §2 で技術的に禁止されている以上、既存コミットの文言修正には
  この正規経路が必要（無いと文言修正が構造的に不可能になる）。
- **検査3（governance-without-goal）**: ステージ済み変更に正本3文書
  （`GOALS.md`・`GUARDRAILS.md`・`bindings/catalog.md`）が含まれるとき、メッセージ本文に
  Gの引用（`G1`〜`G14`）が1つも無ければ exit 1。GOALS.md 運用ルール「どのGにも効かない
  変更は入れない」の機械化（心得→commit-msg フック — G5/G7）。`git commit -v` の
  切り取り線以降（diff）は本文とみなさない。
- **検査4（undeclared-dependency — v2.5・Phase 13）**: ステージ済み変更に**依存マニフェスト**
  （正本: `scripts/repo_scan.py` の `DEPENDENCY_MANIFESTS`——既定4種:
  `package.json`・`pyproject.toml`・`Cargo.toml`・`pubspec.yaml`。**basename 一致**なので
  モノレポのネストも対象）が含まれるとき、その依存セクションに **HEAD と比べて追加された
  名前**があれば、名前がメッセージに現れない限り exit 1
  （`依存追加: <名前> — 理由1行` を本文に書く）。ルート `AGENTS.md` §10「依存は増えて
  よいが、黙って増えてはならない」の機械化——fix⇔テスト（検査2）と同じ「意味論で塞ぐ」型。
  - **対象外の境界**: lockfile（`package-lock.json`・`uv.lock` 等——`DEPENDENCY_MANIFESTS`
    に載せない＝推移的更新は対象外）／**版の更新・削除のみ**（名前集合の差分に出ない）／
    HEAD の無い初回コミット／HEAD に無い**新規マニフェスト**（ファイル全体が diff で見える
    ＝「黙って」ではない）／解釈不能な構文（**警告1行で素通し**——行指向の自前抽出は
    近似、近似は仕様 — §7.4。tomllib は使わない＝Python 下限 3.10 を維持 — §7.1）。
  - 名前照合は大文字小文字と `-`/`_` を畳んだ集合差（PEP 503 相当の近似）、メッセージ
    照合は本文全体（コメント・切り取り線除外後）への大小無視の部分一致。1違反1行で
    `HARD:undeclared-dependency (<パス>)` を列挙する。
- **検査5（feat-without-plan — v2.6 soft 導入・v2.8 hard 昇格＝G14「意図の保存」）**:
  `feat:` がレイヤー直下（正本: `scripts/repo_scan.py` の `PLAN_LAYER_ROOTS`——
  **列充填。空なら不発**＝`layer-violation` と同じ「列充填で有効化」）に **HEAD に無い
  新規ディレクトリ**を作るのに、設計根拠文書（`PLAN_DOC_PATTERNS`——既定 `plan.md` /
  `docs/plans/`。置き場の規約はルート `AGENTS.md` §4）の差分がステージに無ければ、
  `HARD:feat-without-plan` を1ディレクトリ1行で列挙して exit 1。
  fix⇔テスト（検査2・G10＝回帰の複利）と対をなす「**意図の複利**」（G14）——新しい構造には
  設計根拠が同コミットで残る。**逃げ道の意味論は検査2と同一**: 根拠を書けない構造変更は
  feat を名乗らない（refactor / chore）。根拠は1行でもよい——塞がれるのは「黙って」だけ
  （検査4と同じ設計）。
  - 対象外の境界: HEAD の無い初回コミット（検査4と同じ）／レイヤー直下への**ファイル**
    直接追加（ディレクトリを作らない）／HEAD に既存のディレクトリへの追加／ステージ空。
  - 沿革: v2.6 で soft（表示のみ）導入 → **v2.8 で hard 昇格＝G14 新設**（決定点①を
    案Aで確定——同時改修3点セットの記録は §10 Phase 19）。

- **検査6（feat-without-test — v2.13・Phase 25・soft＝警告のみ・**列充填で有効化**——`TEST_PATH_PATTERNS` が空なら不発）**: `feat:` が
  コードファイル（生成物・テスト除く）に触れるのに、テストファイルの変更が1つも無ければ
  `SOFT:feat-without-test` を警告して**通す**。出典: 著名ワークフローの収斂
  （2026-07-07 調査②——Superpowers の test-driven-development は「実装前にテスト」を
  鉄則として強制する等）。fix⇔テスト（検査2・hard）の feat 版だが、テスト不要な feat
  （配線のみ・雛形生成・UI 微調整）が正当に存在するため **soft で観測から始める**
  （v2.6 の検査5と同じ導入経路。昇格トリガーは Phase 25）。
- **検査7（commit-too-large — v2.13・Phase 26・soft）**: 純変更行数（追加+削除。
  生成物と lockfile を除外——数え方の正本は `repo_scan.py` の `COMMIT_SIZE_SOFT_LIMIT`
  =既定 400 行・`LOCKFILE_NAMES`。列が上書き可）が上限を超えたら
  `SOFT:commit-too-large` を警告して通す。大きな塊は「どのゲートがどの変更を検証したか」
  を追えなくする——実行規律2（1機構=1PR）の一般開発版を可視化する（hard にしない理由:
  正当な大型コミット——初回移植・一括リネーム——が普通に存在する。soft の警告が
  分割の習慣を作る側に賭ける）。

- **検査8（test-shrink — v2.18・Phase 30・soft・列充填で有効化——`TEST_PATH_PATTERNS`
  が空なら不発）**: `fix:` / `feat:` でテストファイルが**純減**（削除行>追加行——numstat・
  バイナリ除外）なら `SOFT:test-shrink` を警告して通す。既存テストの弱体化（assertion 削除で
  緑にする）は**門を欺く最短路**であり、red-first（§5）が守る「新テストが親で赤」の外に
  あった空白（調査④ Clean Room QA の脅威モデル）。正当な整理が普通に存在するため soft——
  警告の常態化は保留「Clean Room 隔離テスト」のトリガー実測に当たる。

## 3.5 ブートストラップ監査（`check-bootstrap` — ✅ の再実行検証）✅ — 実行規律1〜4の機械化（v2.12）

§10 実行規律のうち 1〜4（順序・1Step=1コミット・完了=実行結果・虚偽✅の禁止）は、
Stop ゲート（規律7 — §2b）導入後も**心得のまま**残っていた——ブートストラップの ✅ が
自己申告だったため。本節がそれを門に昇格させる。

- **進捗の正本はルート `BOOTSTRAP.md`**（台帳。`missing-required` の対象・完了後も削除しない
  監査証跡）。状態 = 🚧 / ✅ / —（対象外。備考の理由必須）＋ Step 0 が確定する
  固有名詞リストC（Step 1・10 の残置 grep の機械入力）。
- **`scripts/check_bootstrap.py`**（pre-commit の `check-bootstrap`——`files: ^BOOTSTRAP\.md$`
  で**台帳に触れたコミット＝✅ 化の瞬間だけ**発火・CI の `--all-files` では常時再監査＝
  guard-corpus と同じ二重の網）が4種を機械検査する:
  - `bootstrap-order`: ✅ は先頭からの連続でなければならない（— は理由付きで飛ばせる）
    ——規律1。
  - `bootstrap-multi-flip`: 🚧→✅ のフリップは**1コミットに1つ**（HEAD の台帳との diff で
    判定。まとめての完了報告は監査不能）——規律2。
  - `bootstrap-false-done`: **✅ の Step ごとに、検証可能なアサーションをその場で再実行**
    ——規律3・4 の核心。例: Step 1 = 章見出し14本・★/TODO/固有名詞Cの残置 grep、
    Step 2 = `generate_structure --check` の再実行、Step 4 = guard コーパス**全再生**、
    Step 5 = 形式違反メッセージの**注入のやり直し**、Step 10 = コード全ファイルの
    TODO grep。落ちた ✅ は「🚧 に戻して再実装」の指示付き1行（規律4の監査ルールの門化）。
    アサーションは「事後に再実行して検証できる形」に限る近似（§7.4）——実装の質までは
    保証しないが、**虚偽 ✅ と空実装は物理的に積めなくなる**。
  - `bootstrap-demote`: ✅→— の変更禁止（証跡の消去）。✅→🚧 の差し戻しは正規経路。
- **進捗を強要する門ではない**（全行 🚧 の出荷状態では沈黙で通る）——「進める」側の規律は
  プロンプトと Stop ゲート（§2b）が担い、本節は「進んだという主張」だけを検証する。
  タイミングの網羅: ✅ 化コミットで pre-commit が即検証 → 以降のあらゆる PR で CI が
  全 ✅ を再監査（Step 0〜2 の門導入前区間も、Step 3 以降のコミットで遡って検証される）。
- 性能: 台帳に触れたコミットのみ発火のため、重いアサーション（--check・コーパス再生）を
  許容する（§7.7 の例外は guard-corpus と同じ整理）。

## 4. push時（pre-push）（列充填）＋拡張🚧

`stages: [pre-push]` のフック群。コミットのたびに重い検査を待たされるのを避けるため、
push 時に回す。フック自体の導入は §0 の `pre-commit install` に含まれる。
正本: `.pre-commit-config.yaml`。

- **テスト・静的解析**: 採用列の pre-push フック群（`bindings/catalog.md` の paste-block を
  Step 0 で BINDING 領域へ充填。v2キットの出荷状態は空＝Step 6 までに必ず立てる。
  コードよりゲートが先）。CI で初めて赤くなる型・lint エラーを push 時点に1段前倒しし、
  §8.1 の lint 昇格（print禁止等）の発火点もここに置く。
- 🚧 **ブリッジ鮮度**（Phase 6）: `flutter_rust_bridge_codegen generate` を実行し、
  生成物に差分が出たら失敗（§3.2 と同型の「再生成→変更検知」パターンの再利用）。
  Rust 側 API を変えたのにバインディング再生成を忘れ、実行時に初めて壊れる出戻りを塞ぐ。
  codegen は重いので commit ではなく push 段に置く。生成物の場所の正本は
  `flutter_rust_bridge.yaml`。生成物への直接 Edit/Write は §2 の deny に追加する。

## 5. CI（GitHub Actions・最終防衛線）✅＋拡張🚧

`.github/workflows/guardrails-ci.yml`。ローカルのgitフックは原理的に迂回できる（別マシン・
`--no-verify` 等）ため、PRとmainへのpushで同じ検査を必ず再実行する。

- ✅ **`checks` ジョブ**: `pre-commit run --all-files`——pre-commitと全く同じ定義を
  そのまま再実行する（`.pre-commit-config.yaml` が唯一の定義元で、ローカルとCIの検査
  内容がドリフトしない設計）。フックによるファイル変更（＝§3.2 の再生成差分を含む）も
  CI では失敗として現れる。なお `pre-commit run` は既定で pre-commit ステージのフック
  のみ実行し、`stages: [pre-push]` の群は対象外のため、それらは下記の独立ジョブで
  明示的に回す。ジョブ冒頭の公式 setup-uv action が uv を保証する（§7.1。
  `.python-version` に従い Python 自体も uv が自動解決）。
- **言語別テスト・解析ジョブ**: 採用列の paste-block（`bindings/catalog.md`）を BINDING 領域へ
  貼る。v2キットの出荷状態は `checks` ジョブのみ（言語なし）。
- **`e2e` ジョブ（列充填）**: §12.4 の操作レールを PR の赤/緑へ変換する。完成条件は
  「E2E を1本わざと壊した PR が赤」（Step 8b の DoD）。
- ✅ **`red-first` ジョブ（PR のみ・列充填で有効化 — v2.7・Phase 18）**:
  `scripts/check_red_first.py` が PR 範囲（base..head・マージ除外）の `fix:` コミット毎に、
  そのコミットで**追加**されたテストファイル（`TEST_PATH_PATTERNS`）を親コミットの
  一時 worktree へコピーし、採用列の「単一テストファイル実行」
  （`repo_scan.py` の `SINGLE_TEST_COMMAND` / `SINGLE_TEST_CWD`——None なら不発＝
  言語なし出荷と両立）で1ファイルずつ実行する。**少なくとも1つが赤**（非0）なら
  証明成立、全部緑なら `red-first-green` を1コミット1行で報告——検査2（fix⇔テスト対
  — §3.4）の「同梱」を「バグを再現していた証明」まで引き上げ、「直した証明」を
  自己申告から実行結果に変える（G10/G7）。
  - **逃げ道の意味論は検査2と同一**: CI 上で赤にできない修正はコミット本文の
    `RED-FIRST-EXEMPT: 理由` 行で免除する（接頭辞は増やさない——形式規約 §3.4 検査1 を
    守る。免除・対象外はいずれも1行で見える＝静かなスキップの禁止）。
  - **導入強度は required（v2.9・決定点③を確定 — Phase 21）**: 違反は
    `HARD:red-first-green`＋exit 1 でジョブが赤。仕上げはブランチ保護の required checks へ
    本ジョブを登録する（リポジトリ設定——Step 9 ④）。確定の運用条件だった
    **`RED-FIRST-EXEMPT` の乱用監視**は二層で実装: 機械部分＝**理由の無い免除は不成立**
    （通常判定を続行——1行で見える）、人間部分＝レビュー規約（ルート AGENTS.md §8——
    理由の具体性・CI 上の再現不能性・頻度を点検）。表示のみへ戻すロールバックは CI の
    呼び出しに `--soft` を足すだけ（違反は SOFT: 列挙・exit 0。内部エラーの exit 2 は
    どちらのモードでも素通しにしない。ジョブサマリの赤/緑は両モード共通）。
  - **対象外の境界（1行表示・違反にしない）**: 追加テストの無い fix（既存テストへの
    追記は単離できない——同梱自体は検査2が担保済み）／`SINGLE_TEST_CWD` の配線外の
    テスト（単一スロット＝複数言語構成の副言語側）／親の無い初回コミット・親に実行
    ディレクトリが無い場合。
  - **近似は仕様（§7.4）**: 「非0 = 赤」。親で実行エラーになるテスト（fix と同時に
    足したヘルパへ依存する等）も赤と数える——親が fix を欠く事実の現れとして寛大側に
    倒す。ハングは赤の証明にならないため内部エラーで止める（1テスト 300 秒の保険）。
  - exit 契約: 0=違反なし（`--soft`・不発・fix なしを含む）／1=違反あり（`--soft` では
    返さない）／2=内部エラー。呼び出し・worktree の位置・トークン展開の詳細は
    スクリプト先頭ヘッダーが正本（§7 の流儀）。
- 🚧 **`integration-test-windows` ジョブ**（Phase 7）: `windows-latest` ランナーで
  `flutter test integration_test -d windows`。ルート `AGENTS.md` §8 が「本命」と位置づける
  E2E を PR の赤/緑に変換する（現状はローカル手動のみ＝UI貫通の破壊をPRで検出できない）。
  主作業は OR-Tools バイナリの取得・キャッシュと `ORTOOLS_DIR`・PATH の設定。
  その手順の正本は `engine/CLAUDE.md`（Phase 7 で追記）。
- 🚧 **カバレッジ計測**（Phase 7）: `flutter test --coverage`・`cargo llvm-cov` の数値を
  CI のジョブサマリに**表示のみ**する。最初から閾値ゲートにしない（閾値調整という新種の
  出戻りが生まれる）。数値が安定した後に「main を下回ったら赤」のラチェット方式で
  ゲート化を検討する。
- 🚧 **ツールチェーン固定**（Phase 2）: `engine/rust-toolchain.toml` で Rust の channel を
  固定（cargo と CI が自動で追従）。CI の Flutter バージョンをセットアップ action で固定。
  Python は Phase 1 の `.python-version`＋uv で先行して固定済み（§7.1）。
  `build.rs` に `ORTOOLS_DIR` の存在検証を入れ、未設定・不在なら
  `engine/CLAUDE.md` 参照を促す明確なメッセージで即失敗させる。
  「手元では動くのに CI で赤」「環境変数忘れで不可解なリンクエラー」系の出戻りを塞ぐ。

## 6. AGENTS.md / CLAUDE.md の規則（機械検査ではなく、読んで守る規則）✅ — v2.10 で多エージェント対応に再構成

上記1〜5が機械的に検査するのに対し、こちらは「読んで理解して守る」規則。
正本は各ファイルそのもの——ここでは何がどこに書いてあるか、そしてどの機械検査が
それを裏打ちするか（🚧含む）だけを示す。

**二分構成（v2.10・Phase 22——複製ではなく分割）**:
- **ルート `AGENTS.md` ＝ 規約の正本**（旧ルート CLAUDE.md の全章 §0〜§13 を移設）。
  Codex / Cline / Cursor / Windsurf 等はこれをネイティブに直読みする（AGENTS.md 標準）。
- **ルート `CLAUDE.md` ＝ Claude Code 固有の薄い層**。冒頭の `@AGENTS.md` インポート
  （Claude Code は AGENTS.md を直読みしないため、公式ドキュメント記載の到達経路が
  これ。symlink 方式は Windows でプレーンテキスト化するため不採用——§7.2 の前提）＋
  Claude Code だけが持つフック層（§1・§2・§2b・§2c）の説明のみ。
- 同じ内容が2ファイルに存在しないため**同期が不要**（ドリフトが構造的に発生しない — G5）。
  インポート行の存在は `agents-import-missing`（hard — §3.3）が機械強制する。
- **可搬性の空白はフック層だけ**: §3〜§5 の門（pre-commit / commit-msg / pre-push / CI）は
  git フックと CI なので元よりエージェント非依存。Claude Code 以外のエージェントでは
  §1/§2/§2b/§2c の即時ゲートが無い分、AGENTS.md §10-4 の心得と CI が同じ規則を守る。

### ルート `AGENTS.md`（旧ルート CLAUDE.md の章 — v2.10 で移設・章番号は不変）
| 節 | 内容 | 対応する機械検査 |
|---|---|---|
| §0 | よく使うコマンド＝ランタイム共通動詞の表（`dev.py` 10動詞） | §12.1（未配線は明示エラー） |
| §1-3 | ファイル500行・フォルダ7ファイル・ヘッダー一行の規約 | §3.3のsoft検査 |
| §4 | ドキュメントの置き場の分担（索引=STRUCTURE.md／設計根拠=plan.md／導入手順=README.md／技術選定理由=hoge.md／フォルダ知見=各フォルダCLAUDE.md／出戻り防止の地図=本書） | §3.2（STRUCTURE.md鮮度）・§3.4 検査5（feat⇔plan・hard — v2.8・G14） |
| §5 | フォルダ独立性・依存方向（3層構造は一方向のみ） | §3.3のhard検査 |
| §7 | ログ規則（秘匿・例外を握りつぶさない・出力基準） | §3.1 gitleaks・§3.3 log-direct-call / missing-catch-unwind（列充填）・§8 |
| §8 | テスト戦略（テストが通る状態でのみコミット・回帰テスト固定・flaky温床の禁止） | §3.3 test-sleep / test-nondeterminism / test-calls-solver-direct（列充填）・§3.4・§4・§5 |
| §10 | Git規則（GitHub Flow・コミットメッセージ規約） | §3.4（メッセージ形式） |
| §10-4 | **フックとの付き合い方**（迂回禁止・自動修正後は再実行するだけ・2回連続で落ちた時だけ原因調査） | §2・§3.1・§3.2 |
| §12 | 作業開始の定型手順（STRUCTURE.md→hoge.md→対象フォルダCLAUDE.mdの順で読む） | — |
| §13 | **発見の記録先**（再現できるバグ=回帰テスト／直感に反する箇所=近接コメント／フォルダ固有知見=フォルダCLAUDE.md——中央メモは作らない） | §3.4（fix⇔テストの対で「回帰テスト固定」を強制） |

### ルート `CLAUDE.md`（Claude Code 固有の薄い層）
| 節 | 内容 | 対応する機械検査 |
|---|---|---|
| 冒頭 | `@AGENTS.md` インポート（規約本文への到達経路） | §3.3 `agents-import-missing`（hard） |
| フック層 | 編集直後 整形→lint（§1）・迂回/作業消失遮断＋probe（§2）・ターン終了ゲート（§2b）・所有権ガード（§2c）の挙動と一次対応 | §1 §2 §2b §2c そのもの |

### フォルダ別 `CLAUDE.md`（対象フォルダに触れた時だけ読まれる。エージェント非依存の運用は AGENTS.md §12 手順3「触るフォルダの CLAUDE.md を読む」が担う）
- `app/CLAUDE.md` — Flutter層の規約・テストの書き方・LLMデバッグ支援・「発見・ハマりどころ」
- `engine/CLAUDE.md` — Rust層の規約・シフト制約モデル・「発見・ハマりどころ」
- `engine/src/ortools/CLAUDE.md` — OR-Toolsラッパー実装固有の知見

## 7. `scripts/*.py` の仕様（契約）✅

対象: `scripts/generate_structure.py`（STRUCTURE.md を書いてよい唯一の主体）・
`scripts/check_structure.py`・両者が共有する走査モジュール・`scripts/dev.py`
（動詞ルーター——動詞の意味論は §12.1 が契約、実行環境の規律は本節に従う）。
本節は**契約**を規定する。
実装の細部はスクリプト本体の先頭ヘッダーコメントが正本。食い違ったら同一コミットで両方を揃える。

> **なぜ Python か**: 旧 bash 版は「ファイル毎に外部プロセスを起動」する構造で、
> Windows（Git Bash / MSYS2）のプロセス生成は1回数十msと極端に遅く、数百ファイル×
> 数チェックで数十秒かかっていた。Python は pre-commit 自体の実行環境なので実質追加依存
> ゼロで、単一プロセス・全ファイル1回読みなら同じ検査が1秒前後になる。あわせて
> CRLF・BSD/GNU差・cp932 という「bash on Windows」特有の罠も消える——ただし Python には
> Python の Windows 罠があるので §7.2 を絶対規則とし、インタプリタ解決の非決定性という
> 罠は **uv への一本化（§7.1）**で最初から塞ぐ。

### 7.1 言語と実行環境 — Python は必ず uv 経由
- **言語は Python、下限は 3.10**。実際に使う版はルートの **`.python-version` が正本**
  （Phase 1 で新設。uv がこのファイルに従い、該当版を自動取得・追従する）。
- **実行方法は `uv run scripts/xxx.py` のみ**。素の `python` / `python3` / `py` の直呼び、
  `pip` の直叩き、手動 venv は、**pre-commit の entry・CI・ドキュメントのコマンド例を
  含めて全面禁止**。理由: ① インタプリタ解決が決定的になる（PATH 汚染・ランチャー差・
  「手元では動く」の根絶）② Python 未導入マシンでも uv が自動で用意する（セットアップ
  手順が1つ減る）③ 依存が生えても扱いが変わらない（次項）。
- **標準ライブラリのみ**（`re` / `subprocess` / `pathlib` / `sys` / `argparse` / `difflib` /
  `tempfile` / `os`）を原則とする（§7.7 の性能予算のため）。依存がどうしても必要に
  なったら、**そのスクリプトの PEP 723 インラインメタデータ（`# /// script` ブロック）で
  宣言**して `uv run` に解決させる——`requirements.txt`・共有 venv は作らない
  （スクリプトが自己完結し、環境構築という工程自体を持たない）。
- Python 系ツールの導入は `uv tool install`（常用ツール。例: pre-commit）または
  `uvx`（単発実行）。
- 各スクリプト先頭のヘッダーコメントに「役割一行＋本節への参照」を書く
  （ルート `AGENTS.md` §1-3 のヘッダー規約は Python にも適用: `# xxx.py — 役割`）。

### 7.2 Windows 前提の絶対規則（1箇所の違反で恒常的な偽陽性・文字化けを生む）
- **すべての `open()` に `encoding="utf-8"` を明示**。Windows の既定エンコーディングは
  cp932 であり、付け忘れ1箇所で UnicodeDecodeError か文字化けになる。
  読み込みはさらに `errors="replace"`（検査対象に非UTF-8断片が混ざってもクラッシュしない）。
- **`STRUCTURE.md` の書き込みは `newline="\n"` を明示**。既定のままだと Windows で
  CRLF になり、CI（Linux）との間で恒常的に差分が出て鮮度チェックが偽陽性化する。
- **ファイル列挙は `git ls-files -z` を subprocess で呼び、NUL で分割する**。
  パスは常に `/` 区切りで返り、追跡済みファイルのみ・順序も安定。
  `os.walk` / `glob` は禁止（未追跡ファイルの混入・順序不定・セパレータ差）。
- **冒頭で `sys.stdout.reconfigure(encoding="utf-8", errors="replace")`（stderr も同様）**。
  cp932 コンソールへ日本語メッセージを print すると UnicodeEncodeError で
  「検査自体のクラッシュ＝exit 1 誤爆」が起きるのを防ぐ。
- ソートは素の `sorted()`（Unicode コードポイント順）。locale 依存の照合を使わない。

### 7.3 共通走査モジュール（両スクリプトの土台）
- ファイル列挙・読み込み・シンボル/import 抽出の関数は**1つの共通モジュール**
  （例: `scripts/repo_scan.py`）に置き、両スクリプトはそれを import する。
  **同じ正規表現を2箇所に書くことを禁止**——二重実装は必ずドリフトする。
- **全ファイルはプロセス内で1回だけ読む**。ファイル毎の subprocess 起動は禁止。
- **O(N²) の禁止**: 孤立ファイル検出は「各ファイルについて全ツリーを検索」ではなく、
  1パスで（宣言されたモジュール集合, import された参照集合）を作り、集合演算で出す。
  旧 bash 版が数十秒かかった主因のひとつ。

### 7.4 `generate_structure.py` の契約
- **カレントディレクトリ非依存**: 冒頭で `git rev-parse --show-toplevel` によりルートを
  解決し、以降のパスはすべてルート基準。
- **引数なし（既定）**: ルートの `STRUCTURE.md` を再生成して上書き。生成に成功すれば
  **差分の有無に関わらず exit 0**——「古かったこと」の検知は §7.6 の pre-commit 機構に委ねる。
- **`--check`**: 書き込まない。最新なら exit 0、古ければ unified diff（`difflib`）を
  stderr に出して **exit 1**。
- **exit 2**: 内部エラー（git 不在・ルート解決失敗など）。
- **書き込みは原子的**: 同一ディレクトリの一時ファイル（`tempfile`）に全出力してから
  `os.replace()` で置換（Windows でも上書き置換が原子的に効く）。途中で中断されても
  壊れた `STRUCTURE.md` を残さない。
- **決定性（同一ツリー ⇒ バイト一致）**: 出力にタイムスタンプ・絶対パス・ホスト名・
  ユーザー名・実行環境情報を**含めない**（1つでも入れると鮮度チェックが恒常偽陽性化）。
  §7.2 の newline / encoding / sorted 規則と合わせて、**2回連続実行で差分ゼロ**が保証。
- **走査対象**: ツリー表示は git 追跡下のファイル。生成物（`*.g.dart` / `*.freezed.dart` /
  flutter_rust_bridge 生成物）や `build/` 等の除外リストの完全な定義はスクリプト冒頭が正本。
- **公開シンボル抽出**: `app/lib/**/*.dart` と `engine/src/**/*.rs`。
  - Dart: インデント0の `class / abstract class / enum / mixin / extension / typedef /
    トップレベル関数` 宣言のうち、名前が `_` で始まらないもの。
  - Rust: インデント0の `pub` で始まる宣言（`pub(crate)` 等の可視性修飾を含む）——
    `fn / struct / enum / trait / mod / const / type`。impl 内メソッドまで含めるかは実装が正本。
  - いずれも**行指向の正規表現による近似であり、それは仕様**（複数行宣言やマクロ生成物は
    取りこぼし得る。索引の目的には十分で、完全なパーサを持ち込まない。取りこぼしは
    正規表現の1行修正で対応する）。
- **役割一行ヘッダー**: 各ファイル先頭のコメント1行（形式の正本はルート `AGENTS.md` §1-3）
  を抽出しパスの横に併記。未記述なら空欄のまま載せる（黙って落とさない。気づかせる役は
  §3.3 の soft 警告が担当）。
- **出力の骨格**: 先頭に必ず自動生成バナー
  `<!-- AUTOGENERATED by scripts/generate_structure.py — 手で編集しない。更新: uv run scripts/generate_structure.py -->`。
  以降、トップレベルディレクトリごとの節 → 「パス＋役割一行」のツリー →
  ファイルごとの公開シンボル一覧。体裁の細部はスクリプトが正本。

### 7.5 `check_structure.py` の契約
- 呼び出し・ルート解決・exit 2（内部エラー）は §7.4 と同一。
- **hard 違反が1つでもあれば exit 1、soft のみなら stderr 警告＋ exit 0**。
- 出力形式は §3.3 の契約どおり「1違反1行・先頭に規則ID・パス:行番号・説明」。
  検査項目の一覧（何を検査するか）は §3.3 が契約、検出パターンの実体はスクリプトが正本。

### 7.6 pre-commit 側のフック定義との対応
本書の Python スクリプトを呼ぶフックはすべて `language: system`・
`entry: uv run scripts/xxx.py` で定義する（§3.4 の `check_commit_msg.py` も同様）。
- **トップレベルに `default_stages: [pre-commit]` を必ず置く**。pre-commit の仕様では
  stages 未指定のフックは「インストール済みの全フック種」で走るため、無指定だと
  衛生〜構造検査が**コミット毎に2回**（pre-commit 段＋commit-msg 段）・push でさらに1回
  走る（実測でコミット毎2回→1回に半減。§7.7 の予算と G11）。commit-msg / pre-push で
  動かすフックは各フックの `stages` 明示が正本。
- `generate-structure`・`check-structure`: `pass_filenames: false`・`always_run: true`。
- `check-commit-msg`: `stages: [commit-msg]`。**`pass_filenames` は既定（true）のまま**
  ——commit-msg ステージはメッセージファイルのパスを引数として渡す仕様のため、
  false にすると引数が消えて壊れる。
**「差分があれば1回だけ失敗する」挙動の正体**は、pre-commit が「フック実行によって
ファイルが変更された」こと自体を失敗として扱う機構（§3.1 の自動修正フックと同じ仕組み）。
`generate_structure.py` 自身は exit 0 で構わない（§7.4）。

### 7.7 性能予算
コミット毎に走るため、**Windows 実機のフルスキャンで2秒以内（目標1秒）**。
計測は pre-commit を介さず `uv run scripts/check_structure.py` を直接 time で測る
（環境構築済みなら `uv run` 自体のオーバーヘッドは数十ms程度で予算内）。
**編集直後フック（§1・v2.5）は整形＋lint 合計で編集1回あたり3秒以内**——編集は
コミットより桁違いに高頻度のため、予算に収まらない言語の lint は編集直後に置かず
「該当なし（push 段で回収）」としてカタログに記録する（実測: `uvx ruff check` 単一
ファイルで約60ms）。guard コーパス再生は**当初「全行2秒以内」としていたが、v2.22で
Windows 32コア機の実測に基づき是正**: 並列度は `os.cpu_count()` から自動導出しつつ
上限を32→12へ下げ（実測: 8並列を境に頭打ち・旧上限32では逆に悪化するケースも
確認——標準ライブラリで Windows 含め動くため、ユーザー入力も調査スクリプトも不要）、
`.claude/hooks/guard_git_bypass.sh` 側の `grep`/`sed`/`tr` 直呼びを bash 組み込みの
`[[ =~ ]]`・パターン展開へ置き換えて子プロセス起動を1回あたり約18個→約2個
（jq・sed のみ残置）に削減した。**それでも実測は全74行で5〜8秒**（旧: 8〜9秒）——
プロセス起動自体のOSコストが支配的で、2秒という当初予算は複数コアでも達成できない
という実測に基づき、予算を「全行10秒以内（目標5秒）」へ是正する（行数増で超過したら
並列度→guard 内のプロセス起動回数の順に削る。計測は実機・複数コア前提。1コアの
サンドボックス実測は予算対象外）。
予算超過の第一容疑者は常に「プロセス起動回数」と「O(N²)」（§7.3）——今回の是正自体が
その実例（guard 1回の呼び出しで `jq`/`tr`/`sed`/`grep` が10〜15回起動していたことが
根本原因で、並列度の調整だけでは効かなかった）。

## 8. ログ規則の機械化（検査器は同梱✅——lint昇格と単一出口の実装・有効化は §11 Step 6〜7）

ルート `AGENTS.md` §7 は現状すべて「読んで守る」規則。以下でその大半を機械検査に変換する。
機械化できない残り（識別子は載せる／中身は載せない、の判断）は引き続き規約側の責務であり、
その境界を本節で明示する。

### 8.1 リンタ昇格（Phase 2）— 「うっかり print デバッグ残し」を型エラーと同格にする
- **設定値の正本は採用列の「lint昇格」行**（`bindings/catalog.md`）。以下は移植元
  （Flutter + Rust）の参照値。
- `app/analysis_options.yaml`: `linter.rules` で `avoid_print`・`empty_catches` を有効化し、
  `analyzer.errors` で両者を `error` に昇格。
- `engine/Cargo.toml`（Rust 1.74+ の `[lints]` テーブル）:
  `[lints.clippy]` で `print_stdout`・`print_stderr`・`dbg_macro` を `deny`。
- 例外は**その場に `#[allow(...)]` / `// ignore:` を明示**して初めて許される
  （例外が目に見える形でしか存在できないようにする）。
- 発火点: §4 の `flutter analyze --fatal-infos` / `cargo clippy -D warnings` と §5 の CI。

### 8.2 出口の単一化（Phase 4）— フォーマット規約を「規約」から「1箇所の実装」に変える
`[タグ] 操作名: 詳細 (+Xms)` という形式は grep では検証できない。そこで出口を1つにする:
- **app**: `app/lib/services/log.dart` を新設し、公開APIは
  `logOp(String tag, String op, String detail, {Object? error, Duration? elapsed})` の1系統。
  `error` 指定時は操作名の前に `ERROR` を付ける（ルート `AGENTS.md` §7 の形式を実装）。
  `debugPrint` / `print` を呼んでよいのはこのファイルだけ——他ファイルでの直呼びは
  §3.3 の `HARD:log-direct-call` が止める。
- **engine**: `tracing` の初期化とフォーマッタ（同じ `[engine] 操作名: 詳細` 形式）を
  1ファイル（例: `src/logging.rs`）に集約。
- **FFI 境界**: bridge 公開関数を持つファイルには `catch_unwind` が最低1箇所存在する
  こと（パニックを握りつぶさずログして返す——ルート `AGENTS.md` §7）。欠落は
  §3.3 の `HARD:missing-catch-unwind` が止める（存在検査のみの trip-wire。
  「正しく使えているか」まではレビューの責務）。
- **出力の中身（v2.20 — サンプル実装）**: `[タグ] 操作名: 詳細 (+Xms)` は人間が読む前提の
  概念的な形（このキットが規定するのはここまで——ログレベルの種類・タイムスタンプ・
  構造化するか・出力先はプロジェクトの判断 — §8.4）。python-uv 列（`bindings/catalog.md`）
  には、この形を実際に満たす**動作確認済みの参考実装**を追加した——独自スキーマを発明
  せず OpenTelemetry Logs Data Model の命名・構造化ログの実務コンセンサス（ISO 8601 UTC
  timestamp・level・trace_id）・12-factor app「ログはイベントストリーム」に揃えた1行1JSON。
  サンプルは**貼り替え自由な出発点**であり、`check_structure.py` は中身を検査しない
  （`log-direct-call` が見るのは「経由したか」だけ）。他列（ts-react-web/rust/dart-flutter）
  への展開は未実施——今後の列充填で追加する。

### 8.3 秘密の多層防御と責務の境界
- コミット面 = gitleaks（§3.1）が機械検査。
- ログ面 = 出口が `logOp` に単一化されるため、「トークン・パスワード・APIキーを
  `logOp` に渡さない」という判断1点に絞られる。これは機械化しない（できない）ことを
  明示する——ここが規約（ルート `AGENTS.md` §7）に残る最後の責務。

### 8.4 ログ被覆の機械化と限界（`missing-log-coverage` — v2.19・Phase 31）

- **「重要度」は機械化できない**: どの関数がログに値するかは業務文脈の理解を要する
  意味判断であり、構文パターンしか見られない静的検査には原理的に不可能。全関数への
  ログ強制は①ノイズで信号対雑音比を悪化させる②`logOp("x","called","")` のような
  空呼びで簡単に骨抜きにできる、の2点で不採用（実測: Microsoft Research の産業調査
  ではログ済み関数は全体の一部に留まる——logOp呼び出しの有無だけを見る素朴な網羅性は
  現実の実務とも整合しない）。
- **採った設計**: 対象を「重要度」でなく**客観的に検出できる境界**（I/O・外部呼び出し・
  エラーハンドラ——`LOG_BOUNDARY_PATTERNS`）に絞り、境界の前後 `LOG_BOUNDARY_WINDOW`
  行以内に `logOp` 呼び出しか `NO-LOG: 理由` コメントのどちらかを要求する（soft）。
  これは新規発明ではなく、ESLint `eslint-comments/require-description`・Rust clippy
  `allow_attributes_without_reason`・SonarQube S108/S2486（空catchはコメントで許容）
  ・Honeycomb の DBマイグレーションlinter（`atlas:nolint` 注釈）が実際に採用している
  「**存在検査＋可視化**」の定石を踏襲したもの。
- **機械化の限界はここまで**: `NO-LOG:` の**理由の妥当性**は検証しない（できない）。
  空虚な理由でも門は通る——RED-FIRST-EXEMPT と全く同じ境界。ここから先は
  §10 実行規律のレビュー責務（EXEMPT乱用監視と同型の定期監査）に委ねる。Honeycomb も
  同じ設計で「人を信頼し、後で気づいて直す」と公言している——見える化で十分という
  判断はこのキット固有の妥協ではなく、現場で実証済みの落とし所。
- ランタイムでの重複ログの間引き（Sentryのフィンガープリンティング・zapのsampling等）
  は別レイヤーの話であり、ソースコードの被覆検査とは独立——このキットの対象外
  （列採用時にロギングライブラリ側の機能として個別導入する）。
- テスト実行時の出力量に応じて**ログの有無や配置をソースコード側で自動変更する**
  仕組みは不採用: ①出力量は重要度と相関しない（ホットパスほど出力が多く、閾値で
  自動オフにすると一番見たい場所から消える）②テスト実行の偶発的な特性（カバレッジ・
  実行順）に依存し G1 決定性と衝突する③レビューを経ずにソースの挙動が変わる——
  `SURVEY_ZERO_REVIEW.md` が却下した「自己治癒ランタイム」と同じ「門の外の変更経路」。

## 9. テスト規則の機械化（fix⇔テスト対は同梱✅——非決定検査は列充填・ラッパーは §11 Step 8）

ルート `AGENTS.md` §8 の「flaky 温床の禁止」「回帰テスト固定」を機械検査に変換する。
このプロジェクトは**確率的ソルバー（進化計算＋CP-SAT）を抱える**ため、一般則に加えて
ソルバー固有の決定性対策が本命。

### 9.1 `solve_for_test` ラッパー（Phase 5）
- engine に `pub fn solve_for_test(input, seed: u64, max_time: Duration) -> …` を用意する。
  中身は本体 solve の薄いラッパーで、**必ず** `random_seed = seed`・
  `num_search_workers = 1`・`max_time` を設定して呼ぶ。
- 根拠: CP-SAT は並列探索（複数ワーカー）とシード未固定で実行毎に結果が揺れる——
  単ワーカー＋シード固定が flaky 根絶の必要条件。`max_time` は `cargo test` に組み込み
  タイムアウトが無いことへのハング保険（無限に待つ CI ＝最悪の出戻り）。
- テストコードからの本体 solve 直呼びは §3.3 の `HARD:test-calls-solver-direct` が止める。
- 完成条件に含める性質: **同じ seed で2回実行して同じ結果**（決定性のセルフテスト）。

### 9.2 非決定入力の禁止パターン（Phase 5）
テストファイル内に限り、**採用列の「テスト内 非決定」パターン**を §3.3 の
`HARD:test-nondeterminism` として検出する（移植元の例——Dart: `DateTime.now()`・引数なし
`Random()`／Rust: `thread_rng`・`SystemTime::now`）。
時刻や乱数が必要なテストは固定値を注入する（seed 付き `Random(42)`、時刻は引数/
Clock 抽象で渡す）。既存の `test-sleep` 検査と同じ機構にパターンを足すだけ（§7.5）。

### 9.3 fix ⇔ 回帰テストの対 ✅
契約は §3.4 の検査2。ルート `AGENTS.md` §13「再現できるバグ → 回帰テスト」を、
善意ではなく commit-msg フックで担保する。同梱テストが**親コミットで赤だった**
（＝バグを再現していた）ことの機械証明は CI の `red-first` ジョブ（§5 — v2.7）。

### 9.4 E2E とカバレッジ
CI 側の契約として §5 に記載（integration-test-windows ジョブ／カバレッジは表示のみ→
ラチェット）。

### 9.5 外部I/Oの検疫（test-network）— 時刻・乱数に続く第3の非決定源
- 外部I/O（HTTP・生ソケット・外部LLM API・決済・メール送信）は、**単一のシーム**
  （採用列の「外部I/Oシーム」の置き場所）の向こうへ隔離する。UI・ドメイン層に直呼びを
  書かない——§8.2「出口の単一化」と同型の発想を入口にも適用する（G6・G8）。
- **テストが使ってよいのは記録済みフィクスチャ / フェイクのみ**。テストファイル内の
  直呼びは §3.3 の `HARD:test-network` が止める（パターンは採用列）。ネットワークに出る
  テストは flaky（G1違反）と秘匿漏れ（§8.3）の両方の温床。
- 本物のI/Oを検証する統合テストが必要な場合は、E2E（§12.4）か CI の専用ジョブへ隔離し、
  例外は目に見える形でのみ許す（§8.1 と同じ思想）。
- **非決定性の再現そのものがテストの本質という正当なケース**（実ブラウザの分割TCP
  書き込みタイミングを再現する回帰テスト等）が存在する（v2.25・Phase 35）。この場合は
  `test-sleep`・`test-nondeterminism`・`test-network` の3規則いずれも、該当行の前後
  `NONDETERMINISM_EXEMPT_WINDOW`（既定3）行以内に `NONDETERMINISM-EXEMPT: 理由`
  コメントがあれば免除する。理由の妥当性は検証しない——存在検査のみ（`NO-LOG:` /
  `RED-FIRST-EXEMPT:` と同じ「見えるようにするだけ」の境界 — G9）。乱用監視はレビューの
  責務（§8.4 の `NO-LOG:` と同じ運用）。

## 10. 実装ロードマップ（🚧 の唯一の正本）

### 実行規律（§10 の Phase と §11 の Step に共通・LLM のサボりを塞ぐ）

LLM の実装セッションは、省略・先送り・自己申告完了に流れやすい。以下は「心得」ではなく
**判定規則**——1つでも破れば、その Phase / Step は完了扱いにならない。

1. **順序固定・スキップ禁止**。番号順に1つずつ。後続の作業は前段で立てたゲートに
   守られる前提で並んでいるため、順序を入れ替えると「検査されない作業区間」が生まれる。
   （§11 の Step は機械化: `bootstrap-order` が台帳の順序を強制 — §3.5・v2.12）
2. **1 Phase（1 Step）= 1 ブランチ = 1 PR**。複数をまとめない——どのゲートがどの変更を
   検証したのか、後から追えなくなる。
   （§11 の Step は機械化: `bootstrap-multi-flip` が ✅ 化を1コミット1Stepに制限 — §3.5）
3. **完了＝実行結果であり、自己申告ではない**。DoD にあるコマンドを実際に実行し、
   **成功系と違反注入の失敗系の両方**の出力を確認してから ✅ にする。「実装した」は
   完了ではない。「わざと違反して落ちるのを見た」が完了（冒頭の原則）。
   （§11 の Step は機械化: ✅ の主張は `check-bootstrap` が検証可能なアサーションを
   その場で再実行して検証する — §3.5。監査器が再現できない DoD 部分は本規律が心得として残る）
4. **✅ 化は実装と同一コミット**。実装より先に付ける・後から別コミットでまとめて付ける、
   はどちらも禁止（虚偽 ✅ の典型）。後続セッションへの監査ルール: **✅ なのに違反注入で
   落ちない項目を見つけたら、🚧 に戻して再実装する**。
   （§11 の Step は機械化: `bootstrap-false-done` がこの監査ルールそのもの——✅ 化コミット
   自体が検証に合格しないと積めず、✅→🚧 の差し戻しが正規経路 — §3.5・v2.12）
5. **placeholder・TODO・空関数・コメントアウトされた検査の禁止**。スタブを置いた時点で
   未完了。`TODO` の残置は監査 Step の grep で機械的に検出される（§11 Step 10）。
6. **省略記法での完了扱いの禁止**。「他言語も同様」「残りの規則も同じ要領で」で
   まとめない。バインディング表の全行・規則IDの全行を、**1つずつ実装し1つずつ違反注入**する。
7. **途中でターンを終えない**。「続けますか?」で手を止めるのはサボりの一形態。
   終えてよいのは (a) その Phase / Step の DoD をすべて満たした時、または
   (b) 本当に手が止まるブロッカー（DoD が物理的に実行不能等）を具体的に報告する時のみ。
   必要な決定は着手前（§11 なら Step 0、§10 なら契約節の読解）で確定させ、
   途中で仮定して進めない・確定済みの事項を再確認して止まらない。
   （機械化: §2b の Stop ゲートが (a)(b) 以外の終了を差し戻す — v2.4。ただし
   Claude Code 外の環境では本規律が引き続き心得として効くため、文言は残置する）

### 実装セッションの回し方
1. 状態表で未完了 Phase の**先頭**を選ぶ（飛ばさない——後続 Phase は Phase 1 の
   Python 基盤に検査を足す構造になっている）。
2. その Phase の「契約」列の節を読む。実装対象の既存ファイルがあればそれも読む。
3. 実装する。
4. **DoD をすべて満たす**（違反注入含む。上の実行規律 3）。
5. 「同一コミットで更新する文書」欄を処理し、本書の該当箇所を 🚧 → ✅ に更新する。

### 状態表

| Phase | 機構 | 契約 | 状態 |
|---|---|---|---|
| — | 整形フック／迂回防止／衛生チェック／gitleaks／pre-pushフック枠／CI checks ジョブ／STRUCTURE.md鮮度・構造検査（Python/uv版） | §1 §2 §3.1 §3.2 §3.3 §4 §5 | ✅ |
| 1 | 構造スクリプトの Python(uv) 移植（高速化） | §7 | ✅（v2キット同梱） |
| 2 | lint昇格・analyze/clippy前倒し・ツールチェーン固定 | §8.1 §4 §5 | 🚧 |
| 3 | commit-msg 検査（形式＋fix⇔テスト） | §3.4 §9.3 | ✅（v2キット同梱） |
| 4 | ログ出口の単一化＋対応 hard 検査 | §8.2 §3.3 | 🚧 |
| 5 | テスト決定性（solve_for_test＋非決定パターン） | §9.1 §9.2 §3.3 | 🚧 |
| 6 | ブリッジ鮮度＋生成物 deny 拡張 | §4 §2 | 🚧 |
| 7 | CI 拡張（integration_test on Windows・カバレッジ表示） | §5 | 🚧 |
| 8 | ランタイムレール（共通動詞・決定性供給・操作/観察・外部I/O検疫） | §12 §9.5 | 🚧 |
| 9 | guard 迂回コーパス（門番の回帰テスト） | §2 | ✅（v2.4 同梱） |
| 10 | probe 動詞（迂回防止への事前照会） | §2 §12.1 | ✅（v2.4 同梱） |
| 11 | ターン終了ゲート（Stop フック＝実行規律7の機械化） | §2b | ✅（v2.4 同梱） |
| 12 | 編集直後リント（PostToolUse 第2段・3秒予算） | §1 §7.7 | ✅（v2.5 同梱） |
| 13 | 依存追加の明示化 `undeclared-dependency`（commit-msg 検査4） | §3.4 | ✅（v2.5 同梱） |
| 14 | 作業消失ガード（非可逆な消失に限定した遮断＋コーパス前提列） | §2 | ✅（v2.5 同梱） |
| 15 | 世代交代 API 検査 `deprecated-api` | §3.3 | ✅（v2.6 同梱） |
| 16 | 所有権ガード（人間の未コミット変更の上書き防止） | §2c | ✅（v2.6 同梱） |
| 17 | feat⇔plan 対 `feat-without-plan`（soft 導入——v2.8 で hard 昇格 = Phase 19） | §3.4 | ✅（v2.6 同梱） |
| 18 | red-first 証明 CI（fix テストが親コミットで赤だった証明） | §5 | ✅（v2.7 同梱） |
| 19 | feat⇔plan 対の hard 昇格＋G14「意図の保存」新設（決定点①=案Aで確定） | §3.4・GOALS.md レンズ4 | ✅（v2.8 同梱） |
| 20 | Stop ゲート条件B（`dev.py check` 赤で差し戻し——決定点②=強化案で確定） | §2b | ✅（v2.9 同梱） |
| 21 | red-first の required 化＋EXEMPT 乱用監視（決定点③=確定） | §5・ルート AGENTS.md §8 | ✅（v2.9 同梱） |
| 22 | AGENTS.md 可搬化（規約の正本を全エージェント共通へ二分——保留のトリガー発動） | §6 | ✅（v2.10 同梱） |
| 23 | MCP 採用許可リスト `mcp-not-allowed`（2026-07-07 調査の判定を門に固定） | §3.3 §12.4・catalog 注記 | ✅（v2.11 同梱） |
| 24 | ブートストラップ監査 `check-bootstrap`（実行規律1〜4の機械化——虚偽✅の門） | §3.5・BOOTSTRAP.md | ✅（v2.12 同梱） |
| 25 | feat-without-test（soft 導入——著名キット調査②の採用1） | §3.4 検査6 | ✅（v2.13 同梱） |
| 26 | commit-too-large（soft 導入——著名キット調査②の採用2） | §3.4 検査7 | ✅（v2.13 同梱） |
| 27 | kit-source-exempt（キット原本自身の Stop ゲート永久赤の解消） | §3.3 | ✅（v2.14 同梱） |
| 28 | context-doc-too-large（soft——調査③の採用。Skills 化保留のセンサー） | §3.3 | ✅（v2.17 同梱） |
| 29 | env-file-tracked（hard——調査④の採用1。gitleaks の空白） | §3.3 | ✅（v2.18 同梱） |
| 30 | test-shrink（soft——調査④の採用2。既存テスト弱体化の可視化） | §3.4 検査8 | ✅（v2.18 同梱） |
| 31 | missing-log-coverage（soft——I/O・エラー境界のログ被覆＋NO-LOG可視化） | §8.4 | ✅（v2.19 同梱） |

### Phase 1 — Python(uv) 移植 ✅（v2キットに同梱済み）
- `.python-version`・`scripts/repo_scan.py`・`generate_structure.py`・`check_structure.py`
  （§7 準拠）、pre-commit の `uv run` entry、`guardrails-ci.yml` の setup-uv——すべて同梱。
  移植先での DoD 実測（決定性2回一致・違反注入・2秒以内）は §11 Step 2 に統合されている。

### Phase 2 — 静的ゲート一括（すべて設定のみ・相互独立）
- 変える: `app/analysis_options.yaml`・`engine/Cargo.toml`（§8.1）、
  `.pre-commit-config.yaml`（analyze/clippy を pre-push へ §4）、
  `engine/rust-toolchain.toml` 新設・CI の Flutter 版固定・`build.rs` の
  `ORTOOLS_DIR` 検証（§5）。gitleaks はキット同梱済み（§3.1）。
- DoD: 違反注入——① `print` 残し・`dbg!`・空 catch がそれぞれ analyze/clippy で落ちる
  ② `ORTOOLS_DIR` を外して build.rs が明確なメッセージで落ちる。
  全違反を除去して CI グリーン。
- 文書: 本書の該当ステータス。

### Phase 3 — commit-msg 検査 ✅（v2キットに同梱済み）
- `scripts/check_commit_msg.py`・commit-msg ステージのフック定義・
  `default_install_hook_types` の `commit-msg`——すべて同梱。移植先での実体は
  **`pre-commit install` の実行**と DoD 実測（§11 Step 5 に統合）。

### Phase 4 — ログ出口の単一化
- 作る: `app/lib/services/log.dart`・`engine/src/logging.rs`（§8.2）。
- 変える: 既存の `debugPrint` 直呼びを `logOp` へ置換、`check_structure.py` に
  `log-direct-call`・`missing-catch-unwind` を追加（§3.3）。
- DoD: ① 適当なファイルに `debugPrint` を書くと hard で落ちる ② FFI 境界ファイルから
  `catch_unwind` を消すと落ちる ③ 置換後の実ログが `[タグ] 操作名: 詳細 (+Xms)` 形式で
  出ることを1本の統合テストか手動起動で確認。
- 文書: `app/CLAUDE.md`・`engine/CLAUDE.md` に使い方1行、本書。

### Phase 5 — テスト決定性
- 作る: `solve_for_test`（§9.1）。変える: 既存テストをラッパー経由に移行、
  `check_structure.py` に `test-calls-solver-direct`・`test-nondeterminism` 追加（§3.3 §9.2）。
- DoD: ① 同一 seed で2回実行し結果一致 ② テストからの solve 直呼び・`DateTime.now()`
  などの違反注入がそれぞれ落ちる ③ `max_time` を極端に短くしてもハングせず返る。
- 文書: `engine/CLAUDE.md`（ラッパーの使い方と根拠1〜2行）、本書。

### Phase 6 — ブリッジ鮮度
- 変える: `.pre-commit-config.yaml` に pre-push の codegen 鮮度フック（§4）、
  `.claude/settings.json` の deny に生成物パス追加（§2）。
- DoD: ① Rust 側の公開シグネチャを1つ変えて push すると落ち、codegen 実行＋コミットで
  通る ② 生成物への Edit が deny される。
- 文書: 本書。

### Phase 7 — CI 拡張
- 変える: `.github/workflows/guardrails-ci.yml` に `integration-test-windows` ジョブと
  カバレッジサマリ（§5）。
- DoD: ① PR で新ジョブが緑 ② integration_test を1本わざと壊した PR が赤になる
  （E2E ゲートの違反注入）③ OR-Tools キャッシュが2回目以降のジョブで効いている。
- 文書: `engine/CLAUDE.md`（OR-Tools の CI 上の取得・キャッシュ手順）、本書。

### Phase 8 — ランタイムレール（§12 の具体化。新規リポジトリでは §11 Step 8b が同内容）
- 作る/変える: `scripts/dev.py` の COMMANDS 充填（採用列）・時刻注入シーム（§12.2）・
  `.mcp.json`（操作レールが MCP の列）・`test-network` / `ui-missing-testid` の有効化・
  E2E CI ジョブ（§5）。
- DoD: ① 全動詞が「配線済み」か「該当なし」の判断込みでカタログに記録済み
  ② `reset` → 同一操作2回 → 状態一致（G1 の実測）③ エージェントが操作レール経由で
  UI を1回操作し、観察レールで結果（コンソール・DB）を読めたことの実測
  ④ `test-network`・`ui-missing-testid` の違反注入が赤 ⑤ E2E を1本壊した PR が赤。
- 文書: 本書 §12・AGENTS.md §0 の動詞表・カタログの「実測済み」昇格。

### Phase 9〜11 — v2.4 同梱 ✅（guard コーパス／probe／ターン終了ゲート）
- 契約と正本は §2（コーパス・probe）・§2b（Stop ゲート）。移植先での実体は DoD 実測
  （コーパス全行 PASS＋規則1つの無効化注入で赤／probe の DENY・ALLOW／Stop の
  5注入——特に**§2b は fail-open の実測**で、§2 と逆向きの注入を飛ばさない）。

### Phase 12〜14 — v2.5 同梱 ✅（編集直後リント／依存追加の明示化／作業消失ガード）
- 契約と正本は §1（整形→lint の直列2段）・§3.4 検査4・§2 作業消失ガード＋コーパス前提列
  （＋§7.7 の3秒/編集予算）。詳細仕様は各節へ集約済み——本 Phase 節は残置しない。
- 設計時に「実装時確定」としていた2点は次のとおり確定（残置なし）:
  ① **整形→lint の実行順**——公式仕様では同一 matcher の複数フックは並列・順序不定のため、
  2エントリ登録ではなく `settings.json` の**直列1コマンド**で配線（§1。短絡・exit 伝播は実測済み）。
  ② **dirty 条件付き規則の回帰再生**——手動 DoD ではなく**コーパスの前提列**（dirty/clean の
  一時リポジトリフィクスチャ — §2）で機械再生する。
- 移植先での実体は DoD 実測（lint 違反注入→exit 2＋stderr・3秒予算・ツール不在素通し／
  依存追加の4境界＝言及なし赤・言及あり緑・lockfile素通し・版更新素通し／dirty でブロック・
  clean で素通し・`rm -rf .git` 常時ブロック／コーパス全行 PASS＋規則1つの無効化注入で赤）。
- Phase 14 の旧 DoD ⑤（「人間の WIP・自分の WIP を消せない」対の §2c 文書確認）は
  **Phase 16 の DoD へ繰り越し**（下記 Phase 16 ⑤——片翼だけでは対にならないため）。

### Phase 15〜17 — v2.6 同梱 ✅（deprecated-api／所有権ガード／feat⇔plan 対）
- 契約と正本は §3.3 `deprecated-api`（BINDING は `repo_scan.py` の `DEPRECATED_PATTERNS`・
  出典規律はカタログ注記）・§2c（所有権ガード——`session_baseline.sh`＋`guard_human_wip.py`・
  fail-open の非対称・作業消失ガードとの対の完成＝Phase 14 からの繰り越し分）・
  §3.4 検査5 `feat-without-plan`（soft・表示のみ。BINDING は `PLAN_LAYER_ROOTS` /
  `PLAN_DOC_PATTERNS`——空なら不発＝列充填で有効化）。詳細仕様は各節へ集約済み。
- 設計時に「実装時確定」だった点は次のとおり確定（残置なし）:
  ① **deprecated-api はパターン定義の正本ファイル `scripts/repo_scan.py` 自身を除外**——
  違反注入の実測で、paste-block のラベル文字列が自分のパターンに一致する自己偽陽性を
  発見した（定義は引用であって使用ではない。`LOG_EXIT_PREFIXES` と同じ境界の引き方 — §3.3）。
  ② **ts-react-web 列の サーバー側 `getSession(` は対象外の判断**——本列はブラウザ SPA で
  クライアントの `getSession()` は正規 API のため偽陽性>価値（Phase 15 の基準）。判断ごと
  カタログに記録し、SSR / Edge Functions を持つ列を起こす時にそちらへ載せる。
  ③ 検査5 のレイヤー定義は新設 BINDING `PLAN_LAYER_ROOTS`（カタログ表A「設計根拠の
  対象レイヤー」行）——`layer-violation` と同じ「列充填で有効化」の型。
- **決定点①は v2.8 で案A（hard 昇格＝G14「意図の保存」新設）に確定**——実装・同時改修・
  DoD の記録は Phase 19。soft 導入（v2.6）→ 昇格（v2.8）の順序自体はラチェット前例どおり
  （判断の主体はユーザー——決定点の建付けどおり）。
- 移植先での実体は DoD 実測: deprecated-api の違反注入→規則ID 1行で赤・除去で沈黙・
  未走査拡張子の注入→`binding-dead-pattern`・2秒予算内／人間 WIP ファイルへの Edit が
  ブロックされ commit / stash で自動解除・baseline 不在は警告付き素通し・**内部エラー
  注入（git 不在）でも通る**（§2c の fail-open は §2 と逆向きの注入——§2b と同様飛ばさない）
  ／レイヤー直下の新規ディレクトリ feat（plan 差分なし）で SOFT 警告1行・plan 差分ありで
  沈黙・コミットは常に通る（soft の実測）。

### Phase 18 — v2.7 同梱 ✅（red-first 証明 CI）（G10/G7）
- 契約と正本は §5 `red-first` ジョブ（`scripts/check_red_first.py`・BINDING は
  `repo_scan.py` の `SINGLE_TEST_COMMAND` / `SINGLE_TEST_CWD`——None なら不発＝
  列充填で有効化。免除は本文の `RED-FIRST-EXEMPT: 理由` 行——接頭辞は増やさない）。
  詳細仕様は §5 へ集約済み——本 Phase 節は残置しない。
- 設計時に「実装時確定」だった点は次のとおり確定（残置なし）:
  ① **worktree はリポジトリ直下の一時ディレクトリ**（`.red-first-*/`——.gitignore の
  キット区画へ追加）に作る——node/npx のモジュール解決は親ディレクトリを遡るため、
  主チェックアウトの `node_modules` が worktree からそのまま見える（システム temp に
  置くと実行環境の再構築という重い工程が要る）。
  ② **列の現実**: dart-flutter は多層構成（`app/` サブディレクトリでの実行）のため
  cwd スロット `SINGLE_TEST_CWD` を新設して吸収。rust は「該当なし＋代替」——モジュール内
  `#[cfg(test)]` の単独実行が構造的に不能（統合テスト限定の `cargo test --test <名前>` は
  版上げ候補としてカタログに判断ごと記録）。単一スロットのため複数列併用時は
  プライマリ言語の1列だけが配線し、配線外のテストは対象外として1行で見える。
  ③ **導入強度（決定点③）はスクリプトの `--soft` フラグに実装**——required 化は CI の
  呼び出しから1引数を外すだけ（`continue-on-error` 等、CI 実行環境の仕様に依存する
  仕掛けを使わない。表示のみでも内部エラー exit 2 は素通しにならない — Fail Loudly）。
  ※ 決定点③は v2.9 で required に確定した（Phase 21）——本 Phase の出荷形（--soft）は
  ロールバック手段として残る。
- DoD（キットで実測済み——移植先での実体も同じ注入）: ① 親でも緑のテストを fix に
  同梱 → `red-first-green` 1行（`--soft` で SOFT:＋exit 0・外すと HARD:＋exit 1）
  ② 正しい fix（親で赤）→ 証明1行＋exit 0 ③ `RED-FIRST-EXEMPT` 付き → 免除が1行で
  見える ④ 未配線 → 不発1行＋exit 0 ⑤ 追加テストなし fix・初回コミット → 対象外1行。

### Phase 19 — v2.8 同梱 ✅（feat⇔plan 対の hard 昇格＋G14「意図の保存」新設＝決定点①の確定）（G14/G7/G5）
- 契約と正本は §3.4 検査5（`HARD:feat-without-plan`・BINDING は `PLAN_LAYER_ROOTS` /
  `PLAN_DOC_PATTERNS`——空なら不発のまま＝列充填で有効化は据え置き）と GOALS.md レンズ4
  （G14「意図の複利」——fix⇔テスト G10＝回帰の複利の対）。詳細仕様は各正本へ集約済み。
- **決定点①はユーザー判断で案Aに確定**（v2.8）: G14 は判定列が書ける（レイヤー直下の
  新規ディレクトリ feat に根拠差分が同梱される——`feat-without-plan` がゼロ）ため新設可。
  soft の実績は v2.6〜v2.7 の同梱運用——昇格の判断主体はユーザー（決定点の建付けどおり）。
- **同時改修の3点セット**（旧 Phase 15〜17 節が予告していた「昇格時に必要」な改修——
  1つでも漏らすと G14 引用のコミットが検査3で偽陽性になる罠。すべて同一の変更で実施）:
  ① `check_commit_msg.py` の `GOAL_CITATION` を `G(1[0-4]|[1-9])` へ
  ② GOALS.md ヘッダ「G1〜G13」「13条」→「G1〜G14」「14条」＋レンズ4新設・G5 行の
  分担整理（同梱強制は G14 へ移管、G5 は「正本が単一」に純化）
  ③ README・本書・catalog 注記・CLAUDE.md テンプレの soft 表記を hard へ。
- DoD（キットで実測済み——移植先での実体は Step 5 ⑥）: ① レイヤー直下の新規ディレクトリ
  feat（plan 差分なし）→ `HARD:feat-without-plan` 1行＋exit 1（違反注入）
  ② plan 差分を足すと exit 0 ③ refactor: を名乗ると exit 0（逃げ道の意味論）
  ④ 列未充填 → 不発・初回コミット → 素通し（境界の据え置き確認）
  ⑤ 本文の `G14` 引用が検査3を通る・引用なしは落ちる（正規表現の同時改修の実測）。

### Phase 20 — v2.9 同梱 ✅（Stop ゲート条件B＝決定点②の強化案を確定）（G7/G4/G2）
- 契約と正本は §2b（条件A=未コミット作業・条件B=クリーンだが `dev.py check` 赤・
  免除=`BLOCKED:` 報告。ループ保護と fail-open は条件A/Bで共有）。詳細は §2b へ集約済み。
- **決定点②はユーザー判断で強化案に確定**（v2.9）。誤差し戻しのリスクは3つの絞りで
  抑える: ① `HARD:` を含む exit 1 だけが差し戻す（内部エラー・素の非0は素通し）
  ② uv / dev.py 不在は表示1行で条件Aのみへ縮退 ③ 上限3回のカウンタ（v2.4 から共有）。
  条件Bはクリーン時のみ走るため、毎ターンの追加コストは §7.7 の 2 秒予算内。
- DoD（キットで実測済み——手動 JSON 注入。移植先の実体は Step 4 ⑥）:
  ① クリーン＋check 緑 → exit 0（カウンタ削除） ② クリーン＋HARD 違反注入 → exit 2＋
  規則ID入り文面（条件B） ③ ダーティ＋check 赤 → 条件Aの文面（Aが先行）
  ④ transcript に `BLOCKED:` → exit 0（免除は両条件共通） ⑤ check 内部エラー
  （exit 2）注入 → exit 0 ⑥ uv 不在 → 表示1行＋exit 0（⑤⑥は fail-open——§2 と
  逆向きの注入） ⑦ `stop_hook_active`＋カウンタ超過 → exit 0。

### Phase 21 — v2.9 同梱 ✅（red-first の required 化＋EXEMPT 乱用監視＝決定点③の確定）（G10/G7）
- 契約と正本は §5 red-first ジョブ（CI の呼び出しから `--soft` を外した——違反は exit 1
  で赤。`--soft` はロールバック手段として残置）とルート AGENTS.md §8 のレビュー規約。
- **決定点③はユーザー判断で required に確定**（v2.9）。計画の運用条件「最初から
  required にするなら `RED-FIRST-EXEMPT` の乱用監視をレビュー規約に足すこと」を
  二層で実装: **機械部分**＝理由の無い免除は不成立（通常判定を続行——1行で見える）、
  **人間部分**＝レビュー規約（AGENTS.md テンプレ §8: 理由の具体性・CI 上の再現不能性・頻度を点検）。
- **required の完成はリポジトリ設定まで**: ブランチ保護の required checks へ
  `red-first` を登録する（ワークフロー側からは設定できない——Step 9 ④ に組み込み済み。
  未登録でも違反 PR は赤い ✗ として見える）。
- DoD（キットで実測済み）: ① 違反（親でも緑）→ `HARD:red-first-green`＋exit 1
  ② 理由なし EXEMPT → 免除不成立1行＋通常判定続行（違反なら赤のまま）
  ③ 理由あり EXEMPT → 免除1行＋exit 0 ④ `--soft` 付き → SOFT:＋exit 0
  （ロールバック経路の残存確認）。

### Phase 22 — v2.10 同梱 ✅（AGENTS.md 可搬化＝保留項目のトリガー発動）（G13/G5/G7）
- **トリガー成立の記録**: 「Claude Code 以外のエージェント（Codex / Cline 等）の併用が
  実際に発生した時」——ユーザー宣言により成立（v2.10）。登録済みの設計スケッチどおり
  **二分（移設）であって複製ではない**形で実装した。契約と正本は §6。
- 実装: ① `AGENTS.md.template` 新設（旧 CLAUDE.md.template の全章 §0〜§13 を移設・
  章番号不変。§10-4 はエージェント非依存に再構成——Claude Code フック固有の説明は
  CLAUDE.md 側へ） ② `CLAUDE.md.template` を薄い層へ書換（冒頭 `@AGENTS.md`＋フック層の
  説明のみ） ③ `AGENTS.md` を `missing-required` へ・インポート行を
  `agents-import-missing`（hard・`REQUIRED_CONTENT_RULES` の既定1件目）へ ④ 本書・
  GOALS.md・catalog・スクリプトの章参照を `AGENTS.md §N` へ機械改名（章番号不変のため
  1対1置換。移植元原本への言及と変更点の歴史記録は除外）。
- **実装時の事実確認（v2.10 時点の外部裏書き——変わったら本節を更新）**:
  Claude Code は AGENTS.md を直読みせず、`@AGENTS.md` インポートが公式ドキュメント記載の
  手段（ネイティブ対応要望 #6235 は 5,200+ 反応で未実装）。Cursor / Windsurf / Cline は
  ルート AGENTS.md のネイティブ読込を提供済み。Codex は AGENTS.md 標準の本家。
  symlink 方式（`ln -s AGENTS.md CLAUDE.md`）は Windows でプレーンテキスト化する既知の
  罠があり不採用（§7.2 の Windows 前提）。
- **同期スクリプトの不採用（判断ごと記録——再提案ループ防止）**: 「CLAUDE.md を編集したら
  Codex / Cline 用ファイルへ同期するスクリプト」は、同一内容の正本を2つ作った上で
  一致を機械が追いかける構図＝ binding-drift の規約版であり G5 違反。分割なら同期対象が
  存在しない——検査（`agents-import-missing`）は「同期」ではなく「構造の不変条件」を守る。
  Cline 固有の `.clinerules` 等のツール別ルールも同梱しない（各ツールが AGENTS.md を
  直読みする今、増やす価値 < ドリフト面。真にツール固有の規則が生まれた時だけ
  そのツールのファイルに書く——CLAUDE.md と同じ整理）。
- **対象外の境界（1行で明示）**: フォルダ別 CLAUDE.md は据え置き——各エージェントの
  自動探索仕様が割れる領域（Claude Code=CLAUDE.md 自動読込／Codex=入れ子 AGENTS.md）で、
  運用は AGENTS.md §12 手順3「触るフォルダの CLAUDE.md を読む」の指示で全エージェントに
  効く。入れ子 AGENTS.md 対応が実際に必要になったら版上げで検討。
- DoD（実測済み）: ① AGENTS.md 欠落 → `missing-required` 赤 ② CLAUDE.md にインポート
  行なし → `agents-import-missing` 赤・行を足すと沈黙（違反注入） ③ 両テンプレから
  作った状態で check 緑 ④ 章参照の残存 grep 0件 ⑤ 出荷状態の想定出力が §3.3 の
  5件と一致。

### Phase 23 — v2.11 同梱 ✅（MCP 採用許可リスト＝2026-07-07 調査の判定を門に固定）（G3/G5/G7）
- 契約と正本は §3.3 `mcp-not-allowed`（データの正本 = `repo_scan.py` の
  `MCP_ALLOWED_SERVERS`——中立既定値 `{"playwright"}`）・§12.4 の採用規律・カタログの
  「MCP・エコシステム採用規律」注記（ゲート3条の正本）。
- **2026-07-07 の MCP・エコシステム調査の要約（判定の出典）**: 現構成（Playwright MCP
  1本＋CLI 群＋薄い常駐）は推奨形に既に一致し、**即時採用すべき新規はゼロ**。
  継続採用 = Playwright MCP（操作レール §12.4・Web 列のみ。実ブラウザ操作は CLI で
  代替不能な唯一の領域）。不採用 = Serena（memories が §13 中央メモ禁止と衝突・
  STRUCTURE.md と役割重複・効果の実測が割れる）／GitHub MCP（`gh` CLI が完全代替——
  定義常駐 42〜55k トークン・実測約35倍差・注入実証事例）／Supabase・Postgres 系
  （`dev.py db` と CLI で充足・書込ツールは門の外の変更経路）／filesystem 等の基本系・
  sequential-thinking（ネイティブ重複）／memory 系（§13）／プロンプト集型・plugins に
  よるキット配布（規約が同一コミットに固定されない——G5/G1）。保留4件はトリガー付きで
  上記保留節に登録。詳細な判定表と情報源は README v2.11 の不採用記録が転記先。
- **境界（1行で明示）**: 検査対象は**プロジェクト正本（追跡された .mcp.json）だけ**。
  タスク単位のローカル追加（`claude mcp add`——Chrome DevTools MCP 等の保留運用形）は
  追跡外＝自由。門は「常駐の既成事実化」だけを塞ぐ。
- DoD（実測済み）: ① playwright のみの .mcp.json → 沈黙 ② 許可外サーバー追加 →
  `HARD:mcp-not-allowed` 1サーバー1行（違反注入） ③ 解釈不能な JSON →
  `SOFT:mcp-unparseable` で素通し ④ .mcp.json 無し → 不発（出荷状態の想定出力は
  Phase 22 の5件から不変） ⑤ 2秒予算内。

### Phase 24 — v2.12 同梱 ✅（ブートストラップ監査＝実行規律1〜4の機械化。虚偽✅の門）（G7/G4/G2）
- 動機: 「LLM がプロンプト1つでキットを展開できるか」という懸念。
  弱点は実行規律1〜4が**心得のまま**で、✅ が自己申告だったこと。契約と正本は §3.5
  （台帳 `BOOTSTRAP.md`＋監査器 `check_bootstrap.py`・規則ID 4種）。
- **プロンプト分割の不採用（判断ごと記録——再提案ループ防止）**: プロンプトを複数に
  分けるのは「心得の再配置」であり、検証力を足さずに人間の介入回数だけを増やす
  （分割されたプロンプトの中でも LLM は同じようにサボれる）。正しい分割単位は既に
  **1 Step = 1 コミット**として存在し、その完了主張を本 Phase の門が検証する——
  結果として人間は台帳（BOOTSTRAP.md）を見るだけで進捗を監査できる＝分割の利点
  （チェックポイント）はプロンプトを分けずに得られる。なお人間が任意に「Step N まで」と
  区切って依頼する運用は従来どおり可能（門は区切り方に依存しない）。
- DoD（実測済み）: ① 出荷状態（全 🚧）→ 沈黙 ② Step 0 を刻印なしで ✅ →
  `bootstrap-false-done`・Step 1 を ★ 残置で ✅ → 同（違反注入2系統） ③ 順序違反
  （Step 1 が 🚧 のまま Step 2 を ✅）→ `bootstrap-order` ④ 2 Step 同時 ✅ →
  `bootstrap-multi-flip` ⑤ ✅→🚧 差し戻し → 許可・✅→— → `bootstrap-demote`
  ⑥ — の備考なし → `bootstrap-ledger` ⑦ 導入済みスクラッチで Step 0〜5 の正当な
  ✅ 積み上げ → 各コミットで監査 PASS。

### Phase 25 — v2.13 同梱 ✅（feat-without-test・soft——著名キット調査②の採用1）（G10/G4）
- 出典: **2026-07-07 調査②（著名な同種キット）**。Superpowers（obra——公式マーケット
  プレイス収載・数万 star）は RED-GREEN-REFACTOR を鉄則化し「テスト前に書かれたコードは
  削除」とまで規定する。本キットは fix 側（検査2 hard＋red-first CI 証明）のみ機械化済みで
  **feat 側が空白**だった——ここを埋める。ただしプロンプト層の「鉄則」は破れる
  （調査②の Fowler 検証・EPAM 事例が実証）ため、本キットでは commit-msg の門に置く。
- soft で導入する理由と**昇格トリガー**: テスト不要な feat が正当に存在し偽陽性率が
  未知（検査5の v2.6→v2.8 と同じ経路）。トリガー = 数 Phase 分の運用で偽陽性の頻度を
  観察した後、逃げ道の設計（refactor/chore を名乗る or `TEST-EXEMPT: 理由`）とともに
  hard 化を判定する。
- DoD（実測済み）: ① feat＋コード変更＋テスト無し → SOFT 1行・exit 0 ② テスト同梱 →
  沈黙 ③ docs のみの feat → 沈黙（コード条件） ④ fix 側の検査2は従来どおり hard。

### Phase 26 — v2.13 同梱 ✅（commit-too-large・soft——著名キット調査②の採用2）（G11/G4）
- 出典: 調査②の収斂点——Superpowers は plan を「**2〜5分粒度のタスク**」に割ることを
  強制し、各タスクをコミットにする。大きな塊は検証の追跡可能性（どの門が何を検証したか）
  を壊す——実行規律2の一般開発版。純変更行数（生成物・lockfile 除外）の soft 上限
  （既定 400・列上書き可）として可視化する。hard にしない理由は §3.4 検査7 に記録
  （初回移植・一括リネーム等の正当な大型コミット）。
- DoD（実測済み）: ① 401行の注入 → SOFT 1行・exit 0 ② 400行以下 → 沈黙
  ③ STRUCTURE.md・lockfile の巨大 diff は数えない（除外の実測） ④ 予算内。

### Phase 27 — v2.14 同梱 ✅（kit-source-exempt＝キット原本自身の Stop ゲート永久赤の解消）（G9/G4/G7）
- 経緯: このキット原本リポジトリを GitHub へ公開する際、Stop ゲート（§2b 条件B）が
  `missing-required`(AGENTS.md/CLAUDE.md) と `agents-import-missing` の HARD で
  恒久的に赤止まりした。§3.3 の「出荷状態の想定出力」はこの3件を**導入先が Step 1 で
  解消する前提**で正常扱いしていたが、キット原本自身は Step 1 を実行する主体ではない
  （実体化は導入先プロジェクト固有の仕事）ため、この前提が成立しない。
- 検討: 「原本自身にも AGENTS.md/CLAUDE.md を実体化する」案は、キットの立場（規約2文書は
  導入先固有の内容を書く場所——§6）と矛盾するため不採用。「Stop フック側だけ特別扱いする」
  案は、`check_structure.py` 自体の exit コードは赤のままになり `dev.py check` を呼ぶ他の
  文脈（CI 等）との整合が崩れるため不採用。
- 採用: 構造だけでは「キット原本自身」と「導入先が Step 1 未着手なだけ」が同型で見分けが
  つかない（推測禁止 — §7.4 の近似は仕様と異なり、ここは判定を誤ると HARD が消える側の
  リスク）ため、**配布物には複製されない明示マーカー**を新設した:
  `.guardrails-kit-source`（`install_kit.py` の `META_FILES` に同居——バイトコピーされる
  `scripts/repo_scan.py` 自身にフラグを持たせると導入先にも複製され判定が骨抜きになる
  ため、「配布されないファイルの有無」という構造的シグナルに倒した — G9）。
  `repo_scan.is_kit_source_repo()` がこのマーカーを見て、`check_structure.py` の
  `missing-required`(AGENTS.md/CLAUDE.md) と `agents-import-missing` だけを SOFT へ
  降格する（他の必須ファイル・他規則は無傷——キット原本もそれ以外の防壁は全部満たす）。
- DoD（実測済み）: ① マーカーを一時退避 → 3件とも HARD に復帰・exit 1
  （導入先と同じ挙動が確認できる） ② マーカーを戻す → 3件とも SOFT・exit 0
  ③ `install_kit.py` のマニフェスト生成にマーカーが含まれない（導入先に複製されない）
  ④ AGENTS.md/CLAUDE.md 以外の `missing-required` 対象を欠落させても HARD のまま
  （降格対象を2件に限定できている）。

### Phase 28 — v2.17 同梱 ✅（context-doc-too-large・soft——調査③の採用）（G3/G9）
- 出典: **2026-07-07 調査③（ゼロレビュー・自律運用系——ユーザー提供の外部リサーチを
  一次入力として判定。judgment の正本は `surveys/SURVEY_ZERO_REVIEW.md`）**。
  採用2件（本検査＋テンプレ §8 の Testing Trophy 心得2行）・保留1件（依存・脆弱性監査
  CI ジョブ——上記保留節）・不採用7群（自己治癒ランタイム=門の外の変更経路の極致／
  Dark Factory 型自動マージ=統治層の外、ただし Validator≒本キットの CI という整理を記録／
  Telos 型関数単位注釈=形式強制は偽陽性>価値／SOUL・MEMORY・HEARTBEAT=§13 再確認／
  Vibe Testing=非決定な検証は門になれない／トークンバジェット・決定テーブル=対象外だが
  中核思想の外部裏書き／SPEC.md・worktree=調査②再確認）。
- キットの立場の1行固定: **ゼロレビューが買えるのは「機械検査可能な違反ゼロ」まで**。
- DoD（実測済み）: ① 201行の CLAUDE.md 注入 → SOFT 1行・exit への影響なし ② 200行
  ちょうど → 沈黙（境界） ③ フォルダ CLAUDE.md にも効く ④ AGENTS.md は 500 行境界
  ⑤ 出荷状態の想定出力は5件のまま不変。

### Phase 29 — v2.18 同梱 ✅（env-file-tracked・hard——調査④の採用1）（G7/G9）
- 出典: **2026-07-07 調査④（門主導アーキテクチャ群——判定の正本は
  `surveys/SURVEY_GATE_ARCHITECTURES.md`）**。レポートの大半は現行機構の外部裏書き
  （RADAR≒機械の門>人間レビューの実測・PreToolUse≒§2・ペナルティルール≒HARD/SOFT
  二値の下位互換・ループ遮断器≒§2b 回数上限）で、本物の空白が2つ——本 Phase と Phase 30。
- 契約は §3.3。gitleaks の**内容**検査を補完する**存在**検査（must ティアの機械化）。
- 複雑度ゲートは**自作せず**、catalog 注記「関数複雑度ゲートの対応表」に正本化
  （linter の AST が上位互換——重複排除ゲート。Step 6 lint 昇格時の推奨）。
- DoD（実測済み）: ① .env を追跡 → HARD 1行 ② .env.local → HARD ③ .env.example →
  沈黙 ④ 出荷状態の想定出力は5件のまま不変。

### Phase 30 — v2.18 同梱 ✅（test-shrink・soft——調査④の採用2）（G10/G4）
- 契約は §3.4 検査8。**red-first の外にあった空白**: red-first は「新テストが親で赤」を
  証明するが、既存テストの assertion 削除で緑にする経路は未監視だった（Clean Room QA の
  脅威モデル）。soft の理由と Clean Room 保留のセンサー役は §3.4 に記録。
- DoD（実測済み）: ① fix でテスト純減 → SOFT 1行・exit 0 ② 純増 → 沈黙 ③ 列未充填 →
  不発 ④ docs: 件名 → 対象外。

### Phase 31 — v2.19 同梱 ✅（missing-log-coverage・soft——ログ被覆の機械化）（G9/G7/G4）

- 経緯: セッション内の対話（「全関数にログを強制すべきか」「重要度は誰が決めるか」）から
  出発。結論: **重要度判定は機械化できない**（意味判断であり構文検査の範囲外）。全関数への
  一律強制は不採用（ノイズで信号対雑音比が悪化する上、空呼びで簡単に骨抜きにできる）。
  「テスト実行時の出力量で自動的にログのON/OFFやコード上の位置を変える」案も検討したが、
  ①出力量と重要度は無相関（ホットパスほど出力が多く逆効果）②テスト実行の偶発性が
  G1決定性と衝突③レビューを経ないソース変更＝`SURVEY_ZERO_REVIEW.md` が却下した
  「自己治癒ランタイム」と同型、の3点で不採用（詳細は §8.4）。
- 採用: 対象を「重要度」でなく**客観的に検出できる境界**（I/O・外部呼び出し・エラー
  ハンドラ）に絞り、境界の前後で `logOp` 呼び出しか `NO-LOG: 理由` コメントのどちらかを
  要求する存在検査。理由の妥当性は検証しない——RED-FIRST-EXEMPT と同じ境界。
- 外部調査で裏付け（2026-07-08）: ESLint `eslint-comments/require-description`・Rust
  clippy `allow_attributes_without_reason`・SonarQube S108/S2486・Honeycomb の DBマイグレーション
  linter（`atlas:nolint` 注釈・監査プロセスは「特に無し、人を信頼する」と公式ブログで明言）
  ——いずれも「存在検査＋可視化」止まりで、理由の中身までは検証していない。この設計は
  発明ではなく実務で通用している定石の踏襲。Microsoft Research の産業調査（ICSE 2014,
  Fu et al.）も、実際のログ配置は全関数のごく一部に留まることを実測している。
- soft で導入する理由: `LOG_BOUNDARY_PATTERNS`（境界検出）は行指向の近似であり、対象
  言語ごとの偽陽性率が未知（`feat-without-test` の v2.13→v2.13 と同じ経路）。列充填時に
  実測してから hard 昇格を判断する。
- DoD（実測済み・シミュレーション列で注入）: ① 境界行のみでログ被覆なし → SOFT 1行
  ② `logOp(...)` が前後5行以内にある → 沈黙 ③ `NO-LOG: 理由` コメントがある → 沈黙
  ④ `LOG_BOUNDARY_PATTERNS` 未充填（キット原本の現状） → 不発・5件SOFTの基準線に影響なし。

### Phase 32 — v2.22 同梱 ✅（guard コーパス性能是正——プロセス起動回数の削減）（G11/G7）

- 経緯: 導入先プロジェクト（Windows・32論理コア機）で、`guard-corpus` フックが
  pre-commit チェーンの中で断続的に失敗（`guard が10秒以内に返らない`）。単体実行では
  安定して通るが、他のフックと並走する文脈でだけ落ちる——2回連続失敗を実測し、
  ルート AGENTS.md §10-4 の規律どおりリトライを止めて原因調査に切り替えた事例が発生し、
  本キット側で再現・実測した。
- 実測: ① `check_guard_corpus.py` 単体実行でも Windows 32コア機で一貫して8〜9秒
  （§7.7 の旧予算「2秒以内」を約4倍超過）② ワーカー数を1〜48で振った実測で、
  旧実装（`min(32, max(8, 2×コア数), 行数)`）が選ぶ32並列は、8並列と同等かそれ以下——
  「物理コア数より多めが有利」という旧コメントの前提は誤りで、ボトルネックは
  bash/jqプロセス起動自体のOSコストだった（32コア機では常に上限32が選ばれ、
  「プロセス嵐の抑止」という上限の意図が機能していなかった）③ `guard_git_bypass.sh`
  を読み、1回の呼び出しで `grep`/`sed`/`tr`/`jq` が10〜18回起動していることを特定
  （典型的な `git commit -am` で実測 約1073ms/回）④ Windows実機で `bash -c 'true'`
  単体は約44ms/回——ボトルネックはbash起動そのものではなく、内部のプロセス起動の
  カスケードだった。
- 対応: ①`check_guard_corpus.py` の並列度上限を32→12へ下げる（実測: 8並列で頭打ち・
  24並列では旧実装は逆に悪化）②`guard_git_bypass.sh` 本体の `grep -Eq`/`grep -q`
  直呼びを bash 組み込みの `[[ =~ ]]`／`[[ == * ]]`／パターン展開へ置換し、
  `\b`（単語境界）は MSYS2/Windows の bash 正規表現エンジンが非対応と判明したため
  POSIX標準クラスのみで再実装（`word_present()` ヘルパー — `(^|[^[:alnum:]_])word
  ([^[:alnum:]_]|$)`）。jq（JSON解析）と sed（引用符除去の可変長置換）の2個だけ残置——
  安全な組み込み代替が無く、量的にも支配的でないため。jq 不在時の保守的経路（生JSON
  マッチ）は corpus 再生で経路が通らないため変更対象外。
- 実測（是正後）: ① 全74行 PASS を5回連続確認 ② 1回あたりの呼び出しコストが
  約1073ms→約243ms（4.4倍）③ 全行再生は8〜9秒→5〜8秒 ④ **是正の過程でコーパスが
  実際に規範として機能した**——書き換え直後は`\b`非対応により36/74行が不一致になり
  （DENYがALLOWへ後退）、コーパスがこれを機械的に検出して修正に至った（G10「回帰の複利」
  が門番自身の改修にも効いた実例）。
- 境界: `guard_git_bypass.sh` の「jq 不在時の保守的経路」（生JSON直接マッチ）は
  corpus 再生の対象外（`check_guard_corpus.py` は jq を必須ツールとして要求するため
  この経路を通らない）——今回は変更していない。触るなら別コミットで同種の実測を要する。

### Phase 33 — v2.23 同梱 ✅（guard フックの言語移行——bash→Python）（G11/G5/G7）

- 経緯: 「他にも同種の遅い実装が無いか」「そもそもbash採用に根拠はあるか」という
  観点から全フックを棚卸しし、旧 `guard_git_bypass.sh`（v2.22是正後でも
  jq・sedの2プロセスが残存・約243ms/回）を Python へ完全移行して実測した。
- 判断の軸: 「Go/Rustも候補に入れてセットアップ時に最速を実測選択する」案も検討したが
  不採用——実装が使用言語の数だけ増えるとG5「単一の正」に反し、Step 0にコンパイル・
  ベンチマーク工程を足すとG13「移植の定数時間」に反し、Go/Rustのツールチェーンを
  キット自体の新規必須依存にするのは重複排除ゲート違反（このキットが唯一必須にする
  言語ツールは `uv` のみ）。Python は**既存の必須依存の範囲内**で完結する選択。
- 実測（`guard_git_bypass` → `.py`）: ①JSON解析（jq代替）・正規表現（grep代替）・
  引用符除去（sed代替）はすべて標準ライブラリで完結し子プロセスは0——唯一 dirty
  判定の `git status` だけ残る ②Windows実機で bash 版243ms/回 → Python版
  （`uv run python`）約150ms/回 ③`tests/guard_corpus.tsv` 全74行を10回連続PASS
  ④並列再生（コーパスチェッカ内部は `sys.executable` 直起動——同一 `uv run` プロセス内
  なので毎回 `uv run` を再度挟まない）で全74行0.4〜2.9秒（旧bash実装は5〜8秒）——
  §7.7 の「全行10秒以内」予算に対し実測は大幅な余裕。
- 発見した副産物のバグ2件（コーパス・手動検証それぞれで実際に検出——これ自体が
  検証機構の実例）:
  ① 初回移植で `sys.stdin` のUTF-8再設定を忘れ、日本語を含むコミットメッセージで
  JSON解析が壊れていた（`sys.stdout`/`sys.stderr`のみ再設定し`stdin`を漏らした）
  ② 検証用ハーネス側のバグ（本体ではない）——cwdをフィクスチャへ差し替える際に
  guardスクリプトを相対パスで渡すと、guard自身が見つからず「起動できない」が
  そのままDENY扱いに化けて誤判定になった。
- `guard_human_wip.sh`（PreToolUse: Edit|Write|MultiEdit——編集の度に発火する同格の
  ホットパス）も同様に Python 化。**専用の回帰コーパスが元々存在しない**フックのため、
  6ケースの手動比較（baseline該当+dirty=DENY／該当+clean=ALLOW／baseline無し=fail-open
  ALLOW／baseline対象外=ALLOW／file_path無し=ALLOW／session_id要サニタイズ=DENY）で
  新旧の exit code とメッセージ文言が完全一致することを確認。実測 593ms/回 → 230ms/回
  （2.6倍）。GUARDRAILS.md §2「所有権ガードのコーパス再生」の保留トリガー
  （guard_human_wip の改修発生）が本コミットで実際に発火したことを明記——
  `check_guard_corpus.py --hook` 拡張による恒久的なコーパス化は**未実施のまま残す**。
- 境界（このコミット時点でやらなかったこと）: `stop_incomplete_guard.sh`・
  `session_baseline.sh`・`post_edit_format.sh`・`post_edit_lint.sh` の4本は当初、
  優先度が低いと判断して見送った（Stop試行毎・セッション開始1回の頻度差、後2者は
  元々サブプロセス数が少ないという理由）。**`.claude/hooks/` 配下の言語統一
  （G5——実装言語という単一の正）を優先し、同一セッション内で Phase 34 として
  追加実施した。**
- 配布面: `install_kit.py` のマニフェストは `kit_root.rglob("*")` ベースなので、
  `.py` への拡張子変更も追加ファイル扱いとして自動的にマニフェストに含まれる
  （コード変更不要——実際に dry-run で `INSTALLED guard_git_bypass.py` を確認済み）。

### Phase 34 — v2.24 同梱 ✅（残り4フックの言語移行＋post-editツール呼び出しの是正）（G11/G5/G7）

- 経緯: Phase 33 で見送った残り4フックについて、`.claude/hooks/` 配下の言語統一
  （G5——実装言語という単一の正）を優先し、同一手順（実測→移植→検証→配線）で
  追加実施した。あわせて、フック本体をPython化しても呼び出す外部ツール
  （ruff/prettier等）が遅ければ効果が薄いという観点から、`post_edit_format.py`/
  `post_edit_lint.py` が呼ぶ外部ツールの呼び出し方も見直した。
- `stop_incomplete_guard.py`: 実測 約698ms/回→約157ms/回（3.5倍）。条件Bの判定
  （`dev.py check`）も `uv run scripts/dev.py check` の2段 `uv run`（dev.py 経由＋
  check_structure.py 経由）から `sys.executable` で `check_structure.py` を直接1段
  起動する形に変更——`dev.py` の `check` 動詞は列上書き不可・常に固定コマンドなので
  意味は変わらない。検証: dirty即差し戻し／clean+check未導入のfail-open／
  BLOCKED:免除／差し戻し上限3回、の4シナリオで新旧一致を確認。
- `session_baseline.py`: 実測 約356ms/回→約171ms/回（2.1倍）。移植直後、
  baselineファイルの書き込みがCRLFになる差分を検出（Pythonの`write_text`が
  Windowsでは既定で改行変換する——`newline="\n"`明示で修正）。修正後、baseline
  ファイルの中身がbash版とバイト完全一致することを確認。
- `post_edit_format.py`/`post_edit_lint.py`: bash の `case` 拡張子分岐を Python の
  `DISPATCH: dict[str, list[list[str]]]` へ置換。付随して、この2フックが**呼び出す
  外部ツール**の呼び方を実測してcatalog.mdへ反映した（詳細は`bindings/catalog.md`
  「post_edit フックの速度3原則」）: `npx prettier`（ローカルinstall済みでも約900ms/回）
  → `node_modules/.bin/prettier` 直接呼び出し（約240ms/回）／`uvx ruff`（約218ms/回）
  → `uv tool install ruff` 後の直接呼び出し（約156ms/回）。フック本体の言語より
  ここの差の方が大きい場面があることを実測で確認した。rust列の整形は
  `cargo fmt`（クレート単位・cwd切替要）から `rustfmt {file}`（単一ファイル直接・
  DISPATCHの素のargv実行と相性が良い）へ変更——post-editの「1ファイル」契約により
  合う形への改善でもある。
- Go/Rustをフック本体の実装言語として使う案は Phase 33 と同じ理由で再度不採用。
  post_edit フックが呼ぶ**外部ツール**をネイティブバイナリ（rustfmt・Biome等）に
  することとは別の話——フックの言語とフックが呼ぶツールの言語は独立（catalog.md
  「post_edit フックの速度3原則」に明文化）。
- 全6フックがPython化で揃ったことの記録: `guard_git_bypass.py`・`guard_human_wip.py`
  （Phase 33）・`stop_incomplete_guard.py`・`session_baseline.py`・
  `post_edit_format.py`・`post_edit_lint.py`（本Phase）。bash実装は0本になった
  （`.claude/hooks/` 配下はすべて `.py`）。

### Phase 35 — v2.25 同梱 ✅（NONDETERMINISM-EXEMPT——非決定性テストの免除機構）（G9/G1/G7）

- 経緯: 導入先プロジェクトで、実ブラウザがヘッダーとbodyを分割TCP書き込みするタイミング
  差を再現する回帰テストが、`test-sleep`（意図的な `sleep`）と `test-network`
  （意図的な `TcpStream`）の両方に違反として検出された事例が発生した。この種のテストは
  sleep・生ソケットの使用そのものがテストの本質であり、削除すれば再現できなくなる——
  §9.5 に「例外は目に見える形でのみ許す」という原則の記載はあったが、具体的な機構が
  無かった。
- 設計: `NO-LOG:`（§8.4）・`RED-FIRST-EXEMPT:`（§5）と同型の「存在検査のみ・理由必須・
  乱用監視はレビュー」境界を、`test-sleep`/`test-nondeterminism`/`test-network` の3規則
  共通の免除として追加した（3規則は同一テストで同時に発火しうるため、単一のコメントで
  まとめて免除できる設計にした）。判定は `missing-log-coverage` と同じ「境界行の前後
  N行以内」ウィンドウ方式（`NONDETERMINISM_EXEMPT_WINDOW`・既定3・列上書き可）——
  同一行限定にすると、sleep とネットワーク呼び出しが別行にまたがるテストで理由コメントを
  複製する必要が出るため。`test-calls-solver-direct` は対象外——既に
  `SOLVER_TEST_WRAPPER_NAME` の同一行検査という別の免除経路を持つ。
- 検証: 合成 rust フィクスチャで、免除コメント無し（`test-sleep`・`test-network` の
  2件検出）／免除コメント有り（0件）を確認。`check_guard_corpus.py`・
  `check_structure.py`（キット自身）に regressions 無し。
- 配布面: `scripts/repo_scan.py`（`NONDETERMINISM_EXEMPT_PATTERN`・
  `NONDETERMINISM_EXEMPT_WINDOW`）・`scripts/check_structure.py`（`check_tests`）・
  `AGENTS.md.template`・`CUSTOMIZE.md` を更新。

### 保留（トリガー待ち。トリガー成立まで実装しない——ここが登録先）
- **Chrome DevTools MCP（タスク単位・常駐しない）**（G4）: トリガー = Web 列の採用先で
  **性能調査**（Web Vitals・performance trace・ネットワーク詳細）が実タスクとして発生した時。
  運用形 = `claude mcp add chrome-devtools npx chrome-devtools-mcp@latest` → 調査 →
  remove。**`.mcp.json`（常駐枠）には入れない**——操作系は Playwright と同等（両者
  a11y ツリー）で独自価値は性能分析のみ、が 2026-07-07 調査の判定。
- **Context7 MCP**（G4/G13）: トリガー = `deprecated-api` の検出やレビューで**同一
  ライブラリの旧作法生成が繰り返し実測**された時（門で止まってはいるが再発が続く＝
  供給側の欠乏）。採用時は採用規律ゲート3条を通し `MCP_ALLOWED_SERVERS` へ追加＋列の
  `.mcp.json` へ2ツールのみ。呼ぶかは心得依存という弱さを判定に明記すること。
- **Serena MCP（大規模既存リポジトリ限定の再評価）**（G3）: トリガー =
  PROMPT_claude_code_existing の導入先で、清掃 Phase 中の参照追跡がネイティブ検索で
  **溢れる実測**（コンテキスト超過・誤編集）が出た時。導入条件 = `.serena/memories/` は
  生成させないか .gitignore（§13 中央メモ禁止の維持）・編集系ツール不使用（編集は門の
  内側で）。新規リポジトリでは不採用が既定（索引=STRUCTURE.md＋500行/7ファイル上限で
  役割充足・効果の実測が割れている——2026-07-07 調査）。
- **Skills 化（AGENTS.md の手順章の分割）**（G3）: トリガー = `/context` の実測で
  AGENTS.md＋フォルダ CLAUDE.md の常駐が問題化した時、**かつ** `.agents/skills`
  相互運用標準の成熟を確認した時（Claude Code 固有層を厚くする採用は v2.10 の
  多エージェント方針と逆行するコストがある——Phase 22 の境界）。
  センサー = soft `context-doc-too-large`（v2.17——警告の常態化がトリガー実測に当たる）。
- **合流の門（GitHub Merge Queue——調査⑤・企業実証: Rust bors / Uber SubmitQueue /
  Shopify）**（G1/G9）: トリガー = **並行 PR の常態化**（複数エージェント並走・共同開発化）
  **または合流起因の main 赤を1回でも実測**した時。守る対象 = マージスキュー（個別に緑の
  PR 同士の意味的衝突）——**PR 単位の CI では原理的に守れず、リポジトリ内ファイルでも
  実装できない層**（ホスティング側の直列化が正本）。発火時の実装は設定のみ: Step 9 ④の
  required checks を前提に Merge Queue を有効化。現行の部分防御 = CI の `push: main`
  再実行（壊れたら即検知——予防はしない、を明示して運用）。単独・低並行では待ち時間
  コスト > 価値のため発火まで有効化しない。自作（bors 自前運用）は不採用（標準機能が
  存在する今、重複排除ゲート違反）。
- **Clean Room 隔離テスト**（Builder から読めない受け入れテスト——調査④）（G7）:
  トリガー = **テストの改変・弱体化による門の欺きを実際に観測した時**（センサー =
  `test-shrink` の警告常態化）。設計スケッチ: `.cleanroom/` ＋ `.claude/settings.json` の
  `permissions.deny: Read(.cleanroom/**)` ＋ CI 専用実行。コスト注記: 隠しテストは
  **人間が書く**しかない（LLM は読めない物を保守できない）——単独開発では高価なため
  発火まで実装しない。
- **依存・脆弱性監査の CI ジョブ**（osv-scanner / cargo audit / npm audit 等）（G9）:
  トリガー = 対象リポジトリが**本番運用・顧客データ段階**に入った時。設計上の緊張を
  先に記録（調査③）: アドバイザリ DB は日々更新され**同一コミットの CI 結果が時間で
  変わる**（G1 決定性と衝突）——ゆえに非ブロッキングの警告ジョブで開始し、運用実測後に
  ブロッキング昇格を判定する。列の paste-block として追加（キット共通ジョブにはしない）。
- **ストリークブレーカー**（G7）: 同一ファイル連続編集 N 回で強制停止（スラッシングの
  機械的切断——AGENTS.md テンプレ §10-4「2回連続で落ちたら原因調査」の編集側の対）。
  トリガー = Phase 16 のセッション状態基盤（`.claude/session/`）導入後、実セッションで
  スラッシングが観測された時（PreToolUse でのカウントは基盤の副産物として安価）。
- **所有権ガードのコーパス再生**（G10）: `guard_human_wip.py` は §2 コーパスの対象外
  （別フック・baseline という状態を持つ）。**トリガーは v2.23 の言語移行（bash→Python）
  で実際に発火した**——このコミットでは `check_guard_corpus.py` の `--hook` 拡張までは
  行わず、6ケース（baseline該当+dirty=DENY／該当+clean=ALLOW／baseline無し=fail-open
  ALLOW／baseline対象外ファイル=ALLOW／file_path無し=ALLOW／session_id要サニタイズ=DENY）
  の手動diff比較で新旧の完全一致を確認するにとどめた（コミット本文にDoD記録）。
  `--hook` 引数によるコーパス化＝tsv形式の恒久的な回帰資産化は**未実施のまま残す**
  （次にこのフックへ手を入れる時が新トリガー）。
- **製品テストへの変異テスト**（G10・mutmut / Stryker 系）: 門への変異テスト
  （違反注入・Phase 9 コーパス）は実施済み。製品側は red-first（Phase 18）が先。
  トリガー = red-first の required 運用（Phase 21・v2.9〜）が安定し、CI 予算に余裕が出た時
  （導入時もカバレッジ前例に従い「表示のみ→ラチェット」）。

## 11. 新規リポジトリのブートストラップ（言語・構成を指定されたら本節だけで全機構を移植する）

**発動条件**: 本書を渡された LLM が「言語は◯◯、構成は◯◯で新規リポジトリを作って」と
指定されたら、追加の指示を待たずに Step 0 → 10 を**この順で**実行する。
**§10 冒頭の実行規律をそのまま適用**（順序固定・1 Step = 1 コミット・違反注入必須・
虚偽 ✅ 禁止・途中でターンを終えない）。

**配置の前段**: キットがまだ zip / 展開フォルダのままルートに置かれている場合、手で
コピーせず `scripts/install_kit.py` で配置する（README_SETUP.md §1 が正本。既存ファイルは決して
黙って上書きせず、衝突は CONFLICT 行で停止・キット系統の版上げは git 履歴を安全網に
UPGRADED・成功時は zip と展開元を自動で後片付け——G2/G9）。

設計方針: 本書の §1〜§9・§12 は「機構の契約」、**穴埋めの正本は `bindings/catalog.md` の
検証済み列**（本節の表A/B/Dはそのスキーマ定義）。移植とは契約を変えずに列を選んで
充填することであり、**契約側を新言語の都合で緩めない**（緩める必要が出たら、それだけが
ユーザーへの確認事項）。検証済み列が既にある言語なら Step 0 は「列の選択」に縮退する
（G13: 移植の定数時間）。新言語なら列を1回起こしてカタログへ還元する。

### Step チェックリスト（進捗の正本はルート `BOOTSTRAP.md` — §3.5・v2.12）
**進捗状態はルート `BOOTSTRAP.md`（台帳）が唯一の正本**——`check-bootstrap` が ✅ の主張を
再実行検証し、順序・1コミット1Step・虚偽✅を機械強制する（実行規律1〜4の門 — §3.5）。
台帳の更新規律: ✅ 化はその Step の実装と**同一コミット**（台帳を staged に含めることで
監査器が発火する）・完了後も削除しない。下表は各 Step の「完了の証拠」（DoD の要約——
✅ にする前にコミットまでに実測するもの。**監査器が再検証するのはこの一部**であり、
残りは実行規律3が心得として効く）:

| Step | 内容 | 完了の証拠（コミットまでに実測するもの） |
|---|---|---|
| 0 | 入力確定（バインディング表A/B・固有名詞リストC→台帳へ記入） | 全セル充填・空欄ゼロ |
| 1 | 骨格・AGENTS.md / CLAUDE.md・GUARDRAILS.md | 固有名詞とTODOの grep 0件 |
| 2 | uv・`.python-version`・scripts（dev.py 含む）・STRUCTURE.md | 決定性2回一致＋全hard規則の違反注入 |
| 3 | pre-commit 導入（衛生・gitleaks・鮮度・構造） | 3種の違反コミットが各理由で落ちる |
| 4 | 迂回防止（deny・guard・整形・Stopゲート） | `--no-verify`・`--force` push ブロック実測＋コーパス再生 PASS＋Stop 差し戻し実測 |
| 5 | commit-msg 検査 | テスト無し fix が落ちる |
| 6 | push 段（テスト・静的解析・lint昇格） | warning 注入で push が落ちる |
| 7 | ログ単一出口＋hard 検査 | 直呼び注入が落ちる |
| 8 | テスト決定性の hard 検査（＋確率的コンポーネントのラッパー） | 非決定パターン注入が落ちる |
| 8b | ランタイムレール（§12: 動詞充填・決定性供給・操作/観察・E2E） | reset→同一操作2回一致＋testid/network 注入が落ちる＋E2E破壊PRが赤 |
| 9 | CI（全再実行＋テスト＋ツールチェーン固定） | Web 編集の違反 PR が赤 |
| 10 | 総合セルフ監査・残項目の §10 登録 | 監査コマンド群すべて通過＋台帳が全行 ✅/— |

### Step 0 — 入力の確定（ここで埋まらないものだけがユーザーへの質問）
**最初に `bindings/catalog.md` を開き、採用する列を決める**（複数可。プライマリ列を
1つ選び、対象ファイルへ `BINDING-SOURCE: 列ID@版` を刻印する——§12.7）。検証済み列が
あれば A の大半は「列の値を貼る」で終わる。新言語なら、以下の A・B・C・D を**全セル
埋めて新しい列としてカタログへ還元する**。「該当なし」と書くのは可、**空欄は不可**。
埋められないセルはこの時点でまとめてユーザーに確認する——**以降の Step でユーザーに
聞くことは無い**設計。

**A. 言語バインディング表**（言語ごとに1列作る）:

| 項目 | 埋めるもの（例は Dart / Rust / Python） |
|---|---|
| 整形（冪等コマンド） | `dart format` / `cargo fmt` / `uvx ruff format` |
| 編集直後 lint（単一ファイル・3秒予算 — §1 第2段） | `uvx ruff check <file>` / `npx --no-install eslint --max-warnings=0 <file>`。予算に収まらない言語は「該当なし（push 段で回収）」と**判断ごと**記録（v2.5） |
| 静的解析コマンド | `flutter analyze --fatal-infos` / `cargo clippy -- -D warnings` / `uvx ruff check` |
| lint 昇格の設定ファイルと対象規則 | print系・空catch系を error/deny に（§8.1 相当） |
| テストコマンド | `flutter test` / `cargo test` / `uv run pytest` |
| print系直呼びパターン | `debugPrint(` `print(` / `println!` `dbg!` / `print(` |
| ログ単一出口の置き場所とタグ名 | §8.2 相当の1ファイル |
| 公開シンボル抽出の正規表現 | §7.4 の流儀（インデント0・公開のみ・近似は仕様） |
| import/参照抽出の正規表現 | レイヤー検査・孤立検出用 |
| テスト内の非決定パターン | sleep系・now系・seed なし乱数（§9.2 相当） |
| テストファイルの判別規則 | パスか命名規則（§3.4 検査2用） |
| 単一テストファイル実行（§5 red-first用） | `uv run pytest <file>` / `npx vitest run <file>`。実行位置が下層なら cwd も記録（`SINGLE_TEST_CWD`）。単独実行が構造的に不能な言語は「該当なし＋代替」を**判断ごと**記録（v2.7） |
| 依存マニフェスト（§3.4 検査4用） | 既定4種（package.json / pyproject.toml / Cargo.toml / pubspec.yaml）は `repo_scan.py` に同梱済み＝**確認のみ**。独自エコシステムなら `DEPENDENCY_MANIFESTS` へ加算追記（v2.5） |
| 非推奨・世代交代パターン（§3.3 deprecated-api用） | LLM が書きがちな旧 API（例: `datetime.utcnow(`）。**出典①②のみ初期値**（規律はカタログ注記）。無ければ「該当なし」を判断ごと記録（v2.6） |
| 設計根拠の対象レイヤー（§3.4 検査5用） | feat⇔plan 対（hard — G14）が新規ディレクトリを監視するルート（例: `src`——`PLAN_LAYER_ROOTS`。v2.6 soft・v2.8 hard） |
| 生成物パターン（手編集禁止・deny 対象） | §2・§7.4 の除外リスト用 |
| ファイル先頭ヘッダーの書式 | `// x — 役割` 相当 |

**B. 構成バインディング**: レイヤー一覧と依存方向（一方向のみ。§5 相当の図を描く）／
必須ディレクトリ・必須ファイル／フォルダ内ファイル数の例外フォルダ／
**確率的コンポーネントの有無**（ソルバー・乱数探索・外部LLM呼び出し等。有なら
Step 8 でラッパー必須）。

**C. 固有名詞リスト**: 雛形（本書と CLAUDE.md）に残る移植元固有の語を列挙する
（この構成なら例: OR-Tools・flutter_rust_bridge・cxx・シフト・solve_for_test 等）。
Step 1 と Step 10 の grep 検査の入力になる。

**D. ランタイムバインディング表**（§12 の穴埋め。カタログの「ランタイム」区分に対応）:

| 項目 | 埋めるもの |
|---|---|
| 共通動詞の配線 | `up` / `reset` / `seed` / `time` / `test` / `e2e` / `fmt` / `check` / `db` の実コマンド（§12.1。「該当なし」の判断込み） |
| ランタイム到達経路（操作レール） | 実UIをエージェントが操作する手段（Web=Playwright MCP／CLI=そのまま実行 等 — §12.4） |
| 観察レール | コンソール・ネットワーク・DB・ログの読み方（§12.3） |
| 中核不変条件 | このアプリで壊れたら致命の性質（例: 打刻テーブルは append-only）と、それを強制する層（DB権限/型/検査のどれ — §12.6） |
| 外部I/Oの列挙 | 依存する外部サービス全部と、そのシームの置き場所・テスト用フェイク（§9.5） |

- 完了条件: A・B・C・D に空欄が無い。採用列と版が決まり刻印済み。この表自体を最初の
  コミットとして記録する（正本3文書を含むコミットは G引用が必須 — §3.4 検査3。
  例: `feat: Step 0 採用列の確定と刻印（G13）`）。
- ありがちなサボり（禁止）: 例の値をコピペして「埋めた」ことにする（**検証済み列からの
  コピペは逆に正**——検証されていない例のコピペが禁止）／正規表現を「実装時に考える」で
  空ける／確率的コンポーネントを「たぶん無し」で流す／中核不変条件を「特になし」で流す
  （データを持つアプリに不変条件が無いことはまず無い）。

### Step 1 — 骨格と文書
- 作る: B に従うディレクトリ骨格／ルート `AGENTS.md`（`AGENTS.md.template` から）——
  **移植元と同一の章構成（§0〜§13 相当）を維持**し、言語固有部だけ A・B の値で置換する。
  章の削除・統合は禁止（章立て自体が本書 §6 などからの参照点）／ルート `CLAUDE.md`
  （`CLAUDE.md.template` から——冒頭 `@AGENTS.md`＋Claude Code 固有節のみ。**同一コミット**。
  規約本文を複製しない — §6）／`GUARDRAILS.md`・`GOALS.md`・`bindings/catalog.md`——
  3つとも複製する（`missing-required` の対象）。契約は言語なしのまま置換不要で、
  各 BINDING 領域へ採用列の paste-block を充填し、§10 の状態表を空で初期化、
  本 Step チェックリストを 🚧 で複製／最小の README。
- 完了条件: ① AGENTS.md に全章が存在し、CLAUDE.md 冒頭に `@AGENTS.md` がある
  （`agents-import-missing` の沈黙で機械確認） ② C のリストで `git grep` して残置 0件
  ③ 各文書に `TODO` が 0件。
- ありがちなサボり（禁止）: 「この言語では不要」と章を省く／固有名詞の除去を目視で
  済ませる（必ず grep で機械確認）。

### Step 2 — uv とスクリプト（§7 の具体化——索引の決定性）
- 作る: `.python-version`／`scripts/repo_scan.py`・`scripts/generate_structure.py`・
  `scripts/check_structure.py`・`scripts/dev.py`（動詞ルーター——この時点では `check` の
  配線と動詞一覧の表示が動けばよく、残りの充填は Step 8b）。**§7.1〜§7.7 の全箇条を
  満たす**（uv run 必須・Windows 絶対規則・共通モジュール・O(N²) 禁止・原子的書き込み・
  決定性・規則ID出力）。シンボル/import の正規表現は採用列の値を使う。初回の
  `STRUCTURE.md` を生成する。
- 完了条件: ① `uv run scripts/generate_structure.py` を2回連続実行して差分ゼロ
  ② `--check` の exit 0/1・内部エラーの exit 2 を実測 ③ **この時点で実装した hard 規則
  すべて**（レイヤー違反・必須欠落・言語ごとの各パターン）に1件ずつ違反注入し、規則ID
  つきの1行で落ちるのを確認して除去 ④ 全走査2秒以内。
- ありがちなサボり（禁止）: 1言語分だけ実装して「他も同様」／違反注入を代表1件で
  済ませる（**規則ID × 言語の全組み合わせ**）／A の正規表現を実ファイルで試さない。

### Step 3 — pre-commit 導入（**ここから先の全コミットがゲート下に入る**）
- 変える: `.pre-commit-config.yaml`（衛生一式・gitleaks・generate-structure・
  check-structure。entry は §7.6 のとおり `uv run …`）。
  `uv tool install pre-commit` → `pre-commit install`。
- 完了条件: ① わざと違反（末尾空白＋hard 違反1件＋ダミー秘密）を仕込んだコミットが
  **3種それぞれの理由で**落ちる ② 解消後に同じコミットが通る。以降の Step のコミットは
  すべてこのゲートを通過して積まれる——これが Step の順序を入れ替えてはいけない理由。
- ありがちなサボり（禁止）: config を書いて `install` を忘れる（**fail-open の典型**。
  発火の実測まで含めて完了）。

### Step 4 — 迂回防止
- 作る: `.claude/settings.json`（`permissions.deny`: `--no-verify` / `--force` push /
  `pre-commit uninstall` / `STRUCTURE.md` と A の生成物への Edit/Write）・
  `.claude/hooks/guard_git_bypass.py`（exit 2・fail-closed。--no-verify/-n・SKIP=・
  --force/-f push・core.hooksPath を検出——§2）・
  `.claude/hooks/post_edit_format.py`（A の整形コマンドで対象拡張子を判定——§1。v2.24でPython化）・
  `.claude/hooks/post_edit_lint.py`（A の「編集直後 lint」を充填——§1 第2段。v2.5・v2.24でPython化。
  settings.json の PostToolUse は整形→lint の**直列1コマンド**として同梱済み——並べ替えない）。
  同梱済み（v2.4）: `tests/guard_corpus.tsv`＋`scripts/check_guard_corpus.py`
  （門番の回帰テスト＋probe——§2。v2.5 で前提列 dirty/clean と作業消失ガードの行を追加）・
  `.claude/hooks/stop_incomplete_guard.py`（ターン終了ゲート——§2b。v2.24でPython化）。
  同梱済み（v2.6）: `.claude/hooks/session_baseline.py`＋`guard_human_wip.py`
  （所有権ガード——§2c。settings.json の SessionStart / PreToolUse(Edit|Write|MultiEdit)
  も配線済み）——これらの実体は DoD 実測。
- 完了条件: ① `git commit --no-verify` と `git push --force`（引数順を変えた
  `git push origin -f` も）の実行がブロックされる（実測）
  ② `STRUCTURE.md` への Edit が拒否される ③ 対象ファイルを編集した直後に整形が
  当たっている（差分で確認） ④ `uv run scripts/check_guard_corpus.py` が全行 PASS し、
  guard の規則1つを無効化する注入で赤くなる（§2） ⑤ `uv run scripts/dev.py probe
  "git push -f"` が DENY を返す ⑥ ダーティツリーでの Stop が差し戻され（条件A・exit 2）、
  クリーンでも check の HARD 違反を注入した状態で差し戻され（条件B・exit 2＋規則ID
  入り文面 — v2.9）、フック内部エラー・check 内部エラー（exit 2）注入では**通る**
  （exit 0——§2b の fail-open は §2 と逆向きの注入）
  ⑦ lint 違反を注入した編集で exit 2＋stderr が届き、クリーンな再編集では沈黙、
  整形＋lint 合計が3秒以内（§1・§7.7——v2.5） ⑧ dirty ツリーで `git reset --hard` が
  ブロックされ、clean では素通し・`rm -rf .git` は常時ブロック（§2 作業消失ガード——v2.5）
  ⑨ セッション開始時点で dirty だったファイルへの Edit がブロックされ、commit / stash 後は
  通る（自動解除）・baseline 不在は警告付き素通し・**内部エラー注入（git 不在）でも通る**
  （§2c 所有権ガード——v2.6。fail-open は §2 と逆向きの注入——§2b と同様飛ばさない）。
- ありがちなサボり（禁止）: フック内の想定外エラーを exit 1 で返す実装
  （素通りする——§2 の fail-open）。§2b 側を fail-closed で書く実装も同罪
  （壊れたフックがセッションを終了不能にする——非対称の正本は §2b）。

### Step 5 — commit-msg 検査
- スクリプト（`scripts/check_commit_msg.py`）・フック定義・`default_install_hook_types` は
  v2キットに同梱済み——本 Step の実体は **`pre-commit install` の再実行**と DoD 実測。
  テスト判別は A の規則を使う（§3.4）。
- 完了条件: ① 不正プレフィックスで落ちる ② テスト無し `fix:` で落ち、A の判別規則に
  合う変更を足すと通る ③ `Merge` 素通し ④ 再インストール後に発火することを実測
  ⑤ 依存マニフェストに1つ追加＋本文言及なしで落ち、`依存追加: <名前> — 理由1行` を
  書くと通る・lockfile のみ／版更新のみは素通し（§3.4 検査4——v2.5）
  ⑥ `PLAN_LAYER_ROOTS` 充填後、レイヤー直下に新規ディレクトリを作る `feat:`（plan 差分
  なし）が `HARD:feat-without-plan` で**落ち**、plan 差分を足すと通り、refactor: を
  名乗っても通る（§3.4 検査5——v2.8 で hard・G14。逃げ道の意味論の実測まで含めて完了）。
- ありがちなサボり（禁止）: install 再実行忘れ（静かに無効——§0 の注意そのもの）。

### Step 6 — push 段と lint 昇格
- 変える: pre-push フック（A のテストコマンド・静的解析コマンド。codegen を持つ構成なら
  鮮度フックも——§4）／lint 昇格の設定（A の設定ファイル——§8.1 相当）。
- 完了条件: ① print 残し等の warning 級違反を注入 → push が落ちる ② テストを1本
  わざと壊す → push が落ちる ③ 除去して push が通る。
- ありがちなサボり（禁止）: 「テストがまだ無い」を理由に push フックを後回しにする
  ——通るテストを1本置いてでも**ゲートを先に立てる**（コードよりゲートが先）。

### Step 7 — ログ単一出口
- §8.2 の具体化: A の「単一出口の置き場所」にログ関数を実装し、`check_structure.py` に
  `log-direct-call`（境界検査を持つ言語なら `missing-catch-unwind` 相当も）を追加。
- 完了条件: ① 出口以外での print 系直呼びを注入 → hard で落ちる ② 実ログが
  `[タグ] 操作名: 詳細 (+Xms)` 形式で出ることを確認。
- ありがちなサボり（禁止）: 検査だけ足して既存コードの直呼びを移行しない
  （違反ゼロの状態で初めて完了）。

### Step 8 — テスト決定性
- §9 の具体化: A の非決定パターンを `test-nondeterminism` として追加。B で確率的
  コンポーネント「有」なら `xxx_for_test(seed, timeout)` ラッパー＋直呼び禁止 hard を
  実装（§9.1 相当）。
- 完了条件: ① 各パターンの違反注入で落ちる ②（該当時）同一 seed 2回で結果一致・
  timeout を極端に短くしてもハングしない。
- ありがちなサボり（禁止）: 「今のテストには無いから」でパターン追加を省く
  （温床の禁止は予防であって対処ではない）。

### Step 8b — ランタイムレール（§12 の具体化。8 と 9 の番号参照を壊さないため枝番）
- やる: D 表のとおり `scripts/dev.py` の COMMANDS を充填（「該当なし」もカタログに記録）／
  時刻注入シームと `reset`（seed込み）の実装（§12.2）／操作レールの導入（Web 列なら
  `.mcp.json` に Playwright MCP——§12.4）／`test-network`・`ui-missing-testid` の
  パターン有効化／E2E を最低1本（正常系の貫通）と CI の e2e ジョブ（§5）。
- 完了条件: ① `reset` → 同一操作2回 → 状態一致の実測（G1）② エージェントが操作レールで
  UI を1回操作し、観察レール（コンソール/DB）で結果を読めた実測 ③ `test-network`・
  `ui-missing-testid` の違反注入がそれぞれ規則ID付きで落ちる ④ E2E を1本わざと壊すと
  `dev.py e2e` が赤 → 直すと緑。
- ありがちなサボり（禁止）: 動詞を「あとで配線」で残す（未配線はエラーになる設計だが、
  エラーのまま放置するのは fail-open と同罪）／E2E を「アプリがまだ薄いから」で省く
  （薄いうちに貫通1本を立てるのが一番安い——コードよりゲートが先、の実行時版）。

### Step 9 — CI（最終防衛線）
- 作る: ワークフロー——`pre-commit run --all-files`（冒頭に setup-uv）／言語ごとの
  テスト・解析ジョブ／ツールチェーン固定（`.python-version` は済み。各言語の版と
  ビルド必須環境変数の検証——§5 相当）。
- 完了条件: ① 正常 PR で全ジョブ緑 ② **GitHub の Web エディタから**違反を1件コミット
  した検証ブランチの PR が赤（ローカルフックが存在しない正規経路であり §2 の迂回禁止に
  抵触しない——まさに CI が守る「別マシン」シナリオの実測）③ 検証ブランチの削除
  ④ red-first（列を配線した場合——§5）: 親でも緑のテストを fix に同梱した検証 PR が
  **ジョブ赤**（exit 1）・正しい fix で証明1行＋緑・`RED-FIRST-EXEMPT`（理由あり）で
  免除1行・理由なし EXEMPT は免除不成立で赤のまま。仕上げにブランチ保護の
  required checks へ `red-first` を登録する（required の完成はリポジトリ設定まで — v2.9）。
- ありがちなサボり（禁止）: 緑だけ確認して赤の実測を省く。

### Step 10 — 総合セルフ監査と引き継ぎ
- やる: ① 本チェックリスト全行が「実装と同一コミットで ✅ 化」されているかを
  コミット履歴で確認 ② `git grep` で `TODO` 0件・C の固有名詞 0件 ③ §3.3 相当の
  **全規則IDについて**「違反注入で落ちた」実績が Step 2〜8 のどこかにあるか、規則ID一覧と
  突き合わせる ④ ブートストラップに含めなかったプロジェクト固有の防止策（E2E・
  カバレッジ等）を移植先の §10 に Phase として 🚧 登録する。
- 完了条件: ①〜④すべて。ここで移植完了——以降は移植先の §10 と運用ルールに従う。
  完了報告では `CUSTOMIZE.md`（導入後にカスタムできる項目の索引 — v2.21）の存在を案内する
  （機構は揃っていても存在を知らせる導線が無いと発見されない、という穴の是正 — G9）。

---

## 12. ランタイム契約（手・目・土台）——静的工程と直交する、実行時の言語なし契約

§1〜§9 が「編集→commit→push→CI」の静的工程を守るのに対し、本節は**開発ループ中の
実行時**を契約化する。エージェントがバグを再現し・直し・検証するループの3要素——
**手**（環境と実UIを操作できる）・**目**（結果を機械可読に観察できる）・**土台**
（毎回同じ状態から始められる）——を言語なしで規定し、具象値はすべて採用列
（`bindings/catalog.md`）に置く。

### 12.1 共通動詞（手の入口・G2）✅（ルーターは配置済み・配線は列充填）
- **`scripts/dev.py` が全プロジェクト共通の動詞**を提供する:
  `up` / `reset` / `seed` / `time` / `test` / `e2e` / `fmt` / `check` / `probe` / `db`。
  `probe "<cmd>"` は迂回防止（§2）への事前照会——実行前に ALLOW / DENY と理由を返す
  （check と同じく言語なしで即動く kit-native 動詞 — v2.4）。
  動詞の**意味論は全プロジェクトで固定**、配線（実コマンド）だけが列ごとに違う——
  初見のエージェントが AGENTS.md §0 だけで環境に到達できることが判定基準（G2）。
- 各動詞は**冪等**（`up` を2回叩いても壊れない）。冪等性は配線先コマンドの責務。
- **未配線の動詞は明示エラーで落ちる**（静かに何もしない fail-open の禁止——§2 と同思想）。
- コマンド名（PATH 上の名前）は `shutil.which` で解決してから実行する（Windows の
  `.cmd`/`.bat` ランチャーは shell=False の直呼びでは起動できない——§7.2 の趣旨）。
  未導入は導入先（README/採用列の前提ツール欄）を示す明示エラー。
  「該当なし」の判断はカタログの列とD表に記録して初めて有効。
- 出力形式は `[dev] 動詞: コマンド` → `[dev] 動詞: exit N (+Xms)`（AGENTS.md §7 のログ形式）。

### 12.2 決定性の供給（土台・G1）（列充填）
- §9 が非決定の**禁止**（検出）を担うのに対し、本項は**供給**を担う——禁止だけでは
  エージェントは代替手段を持てない。
- **`reset` は seed 込みで既知状態へ戻す1コマンド**であること。完成条件は
  「`reset` → 同一操作2回 → 観察可能な状態（DB・UI）が一致」の実測（Step 8b DoD）。
- **時刻は注入シームで供給する**: アプリは現在時刻を直接読まず、`dev.py time <ISO8601>` で
  凍結できる Clock 抽象を1箇所持つ（締め切り・日跨ぎ・月末のバグ再現が1コマンドになる）。
- 乱数を持つ構成は seed を引数/環境で注入できること（§9.1 のラッパーはその一形態）。

### 12.3 観察レール（目・G4）（列充填）
- エージェントが**実行結果を機械可読に読める経路**を最低3つ持つ:
  ① アプリログ（§8.2 の単一出口——形式が固定なので grep 可能）
  ② ランタイムのコンソール・ネットワーク（Web 列なら Playwright MCP の読取機能）
  ③ 永続状態（`dev.py db "<読み取りクエリ>"`——ローカルDB限定・読み取り用途）。
- 「動いたはず」を禁止し「観察した」に置き換えるための機構——§10 実行規律 3
  （完了=実行結果）の実行時版。

### 12.4 操作レール（手・G2/G6）（列充填）
- **エージェントが実UIを操作できる手段**を1つ確立する。Web 列は Playwright MCP
  （`.mcp.json` に配線。`.claude/settings.json` の `enableAllProjectMcpServers` が
  プロジェクト定義の MCP を有効化する）。CLI 列は「そのまま実行」で足りる。
- **MCP の採用は許可リスト制（v2.11——2026-07-07 調査の判定を門に固定）**: プロジェクト
  正本（`.mcp.json`）に置いてよいのは操作レールの **Playwright MCP のみ**。ツール定義の
  常駐はコンテキストを食い（G3）、書込可能ツールは門の外の変更経路（G7）、CLI がある
  サービスは CLI が桁違いに安い（例: GitHub は `gh`）——判定の正本はカタログの
  「MCP・エコシステム採用規律」、機械強制は §3.3 `mcp-not-allowed`。性能調査等の
  スポット用途は `.mcp.json` に入れず **タスク単位の `claude mcp add` → 作業 →
  `claude mcp remove`**（保留の運用形——§10 保留節。常駐させないこと自体が判定）。
- **UI の操作要素にはテストID属性を必須にする**（採用列の `ui-missing-testid` が hard で
  強制）。エージェントの操作は推測クリックではなくテストID/アクセシビリティ属性の指名で
  行う——UIリファクタでE2Eと操作手順が壊れない（G6: 変更面の最小化）。
- E2E は操作レールの資産化: **再現できたバグは修正前に E2E spec 化**し、fix と同一
  コミットに含める（§3.4 のテスト判別に E2E パスを含めることで機械強制——G10）。

### 12.5 外部I/Oの検疫（土台・G8）
- 契約は §9.5。ランタイム側の含意: ローカル開発は**フェイクで完結**できること
  （`up` が外部サービス無しで立つ）。外部I/Oが無いと動かない開発環境は、決定性（G1）と
  ループ速度（G11）の両方を壊す。

### 12.6 中核不変条件の強制層（G7）
- Step 0 のD表で**このアプリ固有の「壊れたら致命」の性質**を列挙し、それぞれを
  **どの層が機械強制するか**（DB権限・型・§3.3 の hard 検査・CI）を明記する。
  例: 「打刻は追記のみ」→ DB の GRANT で UPDATE/DELETE を誰にも与えない（規約でなく権限）。
- 検査で強制するものは §3.3 の `REQUIRED_CONTENT_RULES` 等へ、権限・型で強制するものは
  その定義ファイルの所在を CLAUDE.md に記録する。「読んで守る」に残すのは機械化不能な
  ものだけ（§8.3 と同じ境界の引き方）。

### 12.7 バインディングカタログの運用（G5/G13）✅
- **具象値の正本は `bindings/catalog.md` の列**（列ID@版）。契約（本書）には具象値を
  書かない——現れる場合は「移植元の例」と明示された参照値。
- **刻印**: 採用列を決めたら、対象ファイル（`repo_scan.py`・`dev.py`・
  `.pre-commit-config.yaml`・`guardrails-ci.yml`・`post_edit_format.py`）のヘッダーに
  `BINDING-SOURCE: 列ID@版` を刻む。不一致は `HARD:binding-drift`、未刻印は
  `SOFT:binding-unstamped`（§3.3——出荷状態では後者が出るのが正常）。
- **還元**: 採用先で列の値を直したら、カタログへ**版上げで還元**する。採用先ローカルの
  黙修正は禁止（ドリフトの人間版）。「要実測」の列は、採用先の Step DoD 通過をもって
  「実測済み」へ昇格し、実測元を列末尾に1行残す。

## この文書自体の運用ルール

- **✅ の正本はここではない**——`.pre-commit-config.yaml` ・ `.claude/` 配下 ・ 各 `CLAUDE.md`
  ・ `.github/workflows/guardrails-ci.yml` ・ `scripts/` 配下が変わったら、このファイルの該当
  セクションも**同じコミットで**直す。
- **🚧 の正本は本書**——実装したら、その実装コミットで該当節を ✅ に更新し、
  §10 の状態表と Phase 記述を更新する（完了 Phase の DoD 詳細は消してよい。状態表の行は残す）。
- **契約と実装の乖離**——どちらが正か判断して同一コミットで両方を揃える。
- **新規リポジトリへの移植は §11**——進捗の正本は移植先に複製した Step チェックリスト。
  移植先で契約を緩めた場合は、その差分を移植先 GUARDRAILS.md に明記する。
- 新しい出戻り防止機構を追加したら、**3点セット**で更新する:
  ① 正本ファイルそのもの（未実装なら §10 に Phase 追加） ② 本書の対応する節
  ③ 冒頭 §0 の一覧表。
- **変更は `GOALS.md` の G を引用する**——本書・キット・カタログへの変更コミット/PRの
  本文に「どのGに効くか」を1行書く。どのGにも効かない変更は入れない。
- **列の値の変更は `bindings/catalog.md` へ版上げで還元する**（§12.7）。
