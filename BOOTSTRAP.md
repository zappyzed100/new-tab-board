# BOOTSTRAP.md — ブートストラップ進捗台帳（機械監査の対象 — GUARDRAILS.md §3.5・§11）

> **この表がブートストラップ進捗の唯一の正本**。各 Step の内容・DoD は GUARDRAILS.md §11。
> 行の書式は機械解析される——列構造・Step 番号・状態記号を崩さない（§3.5）。
> 状態 ∈ `🚧`（未着手/作業中）・`✅`（DoD 完了——**✅ 化コミットで監査器が再実行検証する**）・
> `—`（対象外——備考に理由必須）。
> ✅ 化は **1コミット1Step・番号順**のみ（`check-bootstrap` が機械強制 — 実行規律1〜4）。
> ✅ → 🚧 の差し戻しは正規経路（監査で虚偽 ✅ が見つかった時）。✅ → — は禁止。
> 完了後も削除しない（監査証跡。全行 ✅/— になった時点でブートストラップ完了——
> 完了したら `CUSTOMIZE.md` で導入後にカスタムできる項目を一読する）。

| Step | 内容 | 状態 | 備考 |
|---|---|---|---|
| 0 | 入力の確定（採用列・刻印・表A/B/C/D） | ✅ | 採用列: ts-react-crx@1（bindings/catalog.md 新設）。確率的コンポーネント無・外部I/Oは chrome.storage.local のみ |
| 1 | 骨格と文書（AGENTS.md / CLAUDE.md / 正本複製） | ✅ | 章14本存在・★/TODO/固有名詞C残置0件をgrepで実測。tsc/vitest/eslint/prettier/build実測通過 |
| 2 | uv とスクリプト（索引の決定性） | ✅ | generate_structure 2回連続同一ハッシュ・--check exit0/1実測・フルスキャン0.16秒。hard規則10種(missing-required/layer-violation/test-sleep/test-nondeterminism/test-network/deprecated-api/log-direct-call/ui-missing-testid/mcp-not-allowed/env-file-tracked)を1件ずつ違反注入し規則ID付きで検出→除去を実測。post_edit format→lint実測(1757ms<3秒予算) |
| 3 | pre-commit 導入（ここから門の下） | ✅ | `uv tool install pre-commit`→`pre-commit install`(pre-commit/commit-msg/pre-push全シム導入)。末尾空白+HARD:log-direct-call+AWSキー風ダミー秘密を仕込んだコミットが trailing-whitespace/gitleaks/check-structure の3種それぞれの理由で落ちることを実測。違反ファイル削除後は check-structure exit0・working tree clean |
| 4 | 迂回防止（guard・コーパス・probe・Stop） | 🚧 | |
| 5 | commit-msg 検査 | 🚧 | |
| 6 | push 段と lint 昇格 | 🚧 | |
| 7 | ログ単一出口 | 🚧 | |
| 8 | テスト決定性 | 🚧 | |
| 8b | ランタイムレール（動詞・供給・操作/観察） | 🚧 | |
| 9 | CI（最終防衛線） | 🚧 | |
| 10 | 総合セルフ監査と引き継ぎ | 🚧 | |

## 固有名詞リストC（Step 0 で確定——Step 1・10 の残置 grep の機械入力）

1行1語。移植元固有の語が本当に無ければ `該当なし` と1語だけ書く（空欄・★のままは Step 0 未完了）。

```
該当なし
```
