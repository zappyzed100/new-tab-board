# .guardrails/BOOTSTRAP.md — ブートストラップ進捗台帳（機械監査の対象 — .guardrails/GUARDRAILS.md §3.5・§11）

> **この表がブートストラップ進捗の唯一の正本**。各 Step の内容・DoD は .guardrails/GUARDRAILS.md §11。
> 行の書式は機械解析される——列構造・Step 番号・状態記号を崩さない（§3.5）。
> 状態 ∈ `🚧`（未着手/作業中）・`✅`（DoD 完了——**✅ 化コミットで監査器が再実行検証する**）・
> `—`（対象外——備考に理由必須）。
> ✅ 化は **1コミット1Step・番号順**のみ（`check-bootstrap` が機械強制 — 実行規律1〜4）。
> ✅ → 🚧 の差し戻しは正規経路（監査で虚偽 ✅ が見つかった時）。✅ → — は禁止。
> 完了後も削除しない（監査証跡。全行 ✅/— になった時点でブートストラップ完了——
> 完了したら `.guardrails/CUSTOMIZE.md` で導入後にカスタムできる項目を一読する）。

| Step | 内容 | 状態 | 備考 |
|---|---|---|---|
| 0 | 入力の確定（採用列・刻印・表A/B/C/D） | ✅ | 採用列: ts-react-crx@1（bindings/catalog.md 新設）。確率的コンポーネント無・外部I/Oは chrome.storage.local のみ |
| 1 | 骨格と文書（AGENTS.md / CLAUDE.md / 正本複製） | ✅ | 章14本存在・★/TODO/固有名詞C残置0件をgrepで実測。tsc/vitest/eslint/prettier/build実測通過 |
| 2 | uv とスクリプト（索引の決定性） | ✅ | generate_structure 2回連続同一ハッシュ・--check exit0/1実測・フルスキャン0.16秒。hard規則10種(missing-required/layer-violation/test-sleep/test-nondeterminism/test-network/deprecated-api/log-direct-call/ui-missing-testid/mcp-not-allowed/env-file-tracked)を1件ずつ違反注入し規則ID付きで検出→除去を実測。post_edit format→lint実測(1757ms<3秒予算) |
| 3 | pre-commit 導入（ここから門の下） | ✅ | `uv tool install pre-commit`→`pre-commit install`(pre-commit/commit-msg/pre-push全シム導入)。末尾空白+HARD:log-direct-call+AWSキー風ダミー秘密を仕込んだコミットが trailing-whitespace/gitleaks/check-structure の3種それぞれの理由で落ちることを実測。違反ファイル削除後は check-structure exit0・working tree clean |
| 4 | 迂回防止（guard・コーパス・probe・Stop） | ✅ | guard-corpus全74行PASS・`dev.py probe`のALLOW/DENY実測(DoD④⑤)。当初この会話自身(VSCode拡張/Agent SDK経由)ではPreToolUseフックが発火せず`--no-verify`コミットが実際に成立する重大なギャップを発見したが、VS Code再起動後は本会話自身で①`echo/git add/git commit --no-verify`を1つの複合コマンドとして実行しようとしたところ、実行前に丸ごとブロック(ファイルの変更すら発生せず) ②`STRUCTURE.md`へのEditが`permissions.deny`で拒否 ③dirty状態(README.md未コミット変更あり)での`git reset --hard`が作業消失ガードでブロックされ変更が保全、を**作業者本人として直接**実測した。Stopフック(§2b)の差し戻しメッセージも実際に受け取り、DoDに従い対応した実績あり。`--force`push単体は(originリモート未作成のため)未実測——Step 9でリモート作成後に余裕があれば追加確認する |
| 5 | commit-msg 検査 | ✅ | ①不正prefixで`HARD:commit-msg-format`落ち ②テスト無し`fix:`で`HARD:fix-without-test`落ち→テスト同梱で通過 ③`git merge --no-ff`のデフォルト`Merge branch...`メッセージが素通し ④pre-commit installは全フック種込みで導入済み(Step3で実測済み・再発火をStep5でも確認) ⑤package.jsonへの新規依存追加が名前非言及で`HARD:undeclared-dependency`落ち→`依存追加: 名前 — 理由`で通過、バージョン更新のみは素通し ⑥PLAN_LAYER_ROOTS=["src"]配下への新規ディレクトリを作る`feat:`(plan差分なし)が`HARD:feat-without-plan`+`SOFT:feat-without-test`で落ち→plan.md差分で通過、`refactor:`名乗りはplan無しでも素通し。検証用の一時ファイル・コミットはすべてreset --hardで復元済み(作業ツリーはクリーン) |
| 6 | push 段と lint 昇格 | ✅ | `.pre-commit-config.yaml`にpre-push段の`tsc --noEmit`/`eslint .`/`vitest run`を追加(lint昇格の`no-console`/`no-empty`はStep1のeslint.config.jsで既設定)。`pre-commit run --hook-stage pre-push --all-files`で違反注入を実測: ①`console.log`混入→eslintがexit1で落ち ②アサーション破壊→vitestが落ち ③除去後は3フックとも通過。実`git push`によるフック発火はStep9のリモート作成後に確認する |
| 7 | ログ単一出口 | ✅ | `src/lib/log.ts`の`logOp(tag, op, detail, {error, elapsedMs})`を実装し`src/lib/storage.ts`のNO-LOGコメントを実際の呼び出しに置換。単体テスト3件(形式・elapsedMs付与・error付与)で`[タグ] 操作名: 詳細 (+Xms)`形式の出力を実測。log.ts以外でのconsole.log直呼びを注入し`HARD:log-direct-call`で検出→除去を実測。FFI境界(missing-catch-unwind)は該当なし(表B: Chrome拡張にFFI境界は無い) |
| 8 | テスト決定性 | ✅ | 確率的コンポーネントは無い(表B)ため`solve_for_test`相当のラッパーは該当なし。`test-sleep`(setTimeout)・`test-nondeterminism`(Date.now/new Date/Math.random)・`test-network`(fetch)の3パターンを1テストファイルへ一括注入し、全て規則ID付きで検出→削除後にcheck-structureがexit0に戻ることを実測(パターン自体はStep2でrepo_scan.pyへ充填済み) |
| 8b | ランタイムレール（動詞・供給・操作/観察） | ✅ | `scripts/{reset-e2e-profile,seed-board,set-time-freeze,dump-storage}.mjs`を実装し`dev.py`の全10動詞が実コマンドに配線済み(未配線ゼロ)。`src/lib/clock.ts`(時刻シーム)を実装しCardに`createdAt`を追加。`e2e/fixtures.ts`+`board.spec.ts`でビルド済み拡張機能を実際にpersistent contextへロードして検証するE2Eを1本実装。実測: ①`reset`→`seed`→`db`を2回実行し出力が完全一致(G1決定性) ②`dev.py e2e`が正常系で緑・アサーションを壊すと赤・戻すと緑(違反注入) ③`test-network`/`ui-missing-testid`はStep2/Step8で規則ID付き検出済み。CIに`ts-test`/`e2e`ジョブを追加(Step9のリモート作成後に実働確認)。E2Eのservice worker発見のため最小限のbackground service worker(`src/background/background.ts`)を追加し、根拠をplan.mdに記録 |
| 9 | CI（最終防衛線） | 🚧 | `gh repo create --public`でリモート作成しmainへpush(GitHub: zappyzed100/new-tab-board)。①正常pushでchecks/ts-test/e2e全ジョブ緑を実測(初回はcheck-bootstrapのStep3再検証がCI環境を考慮しておらずHARDで落ちるバグを発見、`os.environ.get("CI")`除外を追加し是正) ②GitHub Contents API(ローカルフックを一切通さない経路)でlog-direct-call違反を検証ブランチへ直接コミットしPRを作成→checks/ts-testが正しく赤くなることを実測→PRクローズ・ブランチ削除で後片付け済み。**キット更新（Phase 40・v2.35）で追加された `verify_required_checks` の実測検証により✅から差し戻し**: `checks`/`red-first`/`commit-msg-history` の3コアジョブが GitHub 側のブランチ保護/ルールセットに required として未登録であることを実際の `gh api` 照会で検出（旧版にはこの検証自体が無かった）。ブランチ保護の登録はリポジトリ管理者設定の変更にあたり、GitHub 設定画面（Settings → Branches → Rulesets）からユーザー本人が行う必要がある——CLIでの自動化はスコープ外（§11 Step 9 ④） |
| 10 | 総合セルフ監査と引き継ぎ | 🚧 | ①台帳全行(Step0〜9)が実装と同一コミットで✅化済みであることをgit logで確認 ②追加で違反注入実測: binding-drift・hook-type-missing・missing-log-coverage・commit-too-large(soft)・test-shrink(soft)・context-doc-too-large(soft)・binding-dead-pattern・NONDETERMINISM-EXEMPT免除・所有権ガード(guard_human_wip)ブロック/自動解除・Stop条件B(clean+HARD)/BLOCKED免除・bootstrap-multi-flip・bootstrap-demote・red-first-green(検証PR)——いずれも規則ID付きで検出→復元を実測。未実測(`guard-corpus-mismatch`の実弱体化・`hooks-path-overridden`の直接検証)は実行ハーネスの安全分類器がガード自己改変とみなしブロックしたため断念し、.guardrails/GUARDRAILS.md §10 Phase 32へ🚧登録した。**キット更新（Phase 47・v2.45）で `assert_step_10` の TODO 語検査が全追跡ファイル走査へ強化され✅から差し戻し**: `\bTODO\b` の単語境界一致が、本アプリの機能名そのもの（「TODOリスト」機能・`src/newtab/App.tsx`・`src/lib/gemini/noteAi.ts`・`src/newtab/components/shell/DataPanel.tsx`・`e2e/specs/special.spec.ts` 内のコメント/UI文言）に4件一致した——いずれも未着手作業のマーカーではなく製品機能名としての「TODO」で、実装漏れは無い（該当箇所を目視確認済み）。この検査は存在検査のみで語の用途を判定しないため（G9の設計どおり）機械的には解消不能——製品の機能名を変える対応は本キット更新の範囲外のため見送り、恒久的な既知差分として記録する |

## 固有名詞リストC（Step 0 で確定——Step 1・10 の残置 grep の機械入力）

1行1語。移植元固有の語が本当に無ければ `該当なし` と1語だけ書く（空欄・★のままは Step 0 未完了）。

```
該当なし
```
