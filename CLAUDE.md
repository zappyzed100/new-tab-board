@AGENTS.md

# CLAUDE.md — Claude Code 固有の追記（規約の正本は AGENTS.md。本文を複製しない）

冒頭の `@AGENTS.md` が全エージェント共通規約（§0〜§13）を取り込む——Claude Code は
AGENTS.md を直読みしないため、このインポートが公式ドキュメント記載の到達経路
（GUARDRAILS.md §6。symlink 方式は Windows でプレーンテキスト化する罠があるため不採用）。

## Claude Code だけの追加の門（フック層 — GUARDRAILS.md §1・§2・§2b・§2c）
AGENTS.md の規則のうち以下は、Claude Code ではフックで**技術的にも**強制される
（他エージェントにこの層は無い——同じ規則が AGENTS.md §10-4 の心得＋commit/push/CI の門で効く）:
- **編集直後の整形→lint**（§1）: 自動で走る。lint の exit 2 は stderr の指摘を**その場で**
  直してから次へ進む（後回しにしても push 段で同じ違反に落ちる）。
- **迂回・作業消失の遮断**（§2）: `--no-verify` / `SKIP=` / force push / `core.hooksPath`
  付け替え、および `.git` を含む `rm -rf`・dirty 時の `git reset --hard` 等は exit 2 で
  ブロック。通るかは実行前に `uv run scripts/dev.py probe "<cmd>"` で照会できる。
- **所有権ガード**（§2c）: セッション開始時点で**人間の**未コミット変更があったファイルへの
  Edit/Write はブロック——人間が commit / stash するのを待つ（自動解除）。
- **ターン終了ゲート**（§2b）: 未完了（未コミット作業 or `dev.py check` 赤）のまま
  ターンを終えると差し戻される。物理的ブロッカーは応答の先頭を `BLOCKED:` で始めて
  具体的に報告する。

## UI/CSS変更を「直った」と報告する前に必ず実測する（ユーザーからの再三の指摘）
このセッションで、スクリーンショットを軽く目視しただけで「直った」と報告し、
実際にはレイアウトが壊れたまま（ボタンが見出しに重なる/離れすぎる、要素同士の
横幅が食い違う等）だった事例が複数回発生した。UI/CSSを変更したら、コミット・
報告の前に必ず次を両方行う:
1. Playwright MCP の `browser_evaluate` で対象要素の `getBoundingClientRect()`/
   `getComputedStyle()` を実測し、期待する数値関係（重なっていないか・幅が
   揃っているか等）をコード上の条件で確認する。スクリーンショットの目視だけで
   済ませない。
2. 数値で崩れていないことを確認できたら、可能な限りE2Eの回帰テストとして
   その数値条件をそのままコード化する（`fix:` コミットの回帰テスト要件を兼ねる）。
「スクリーンショットを見て違和感がなかった」は検証したことにならない——
別要素と重なっていても小さい画像では気づきにくい。

## UI スキル(`.claude/skills/` — ベンダー領域)

[.claude/skills/](.claude/skills/) は
[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
からのベンダーコピー(オーケストレータ + サブスキル6つ)。**手で編集しない**。
出所 SHA と更新手順は [.upstream/sources.yaml](.upstream/sources.yaml)(id: ui-ux-pro-max-skill)が正本。

採用時の特別対応3点(2026-07-15 決定・経緯は sources.yaml の rationale)。
いずれも管理区画(`>>> GUARDRAILS BINDING >>>`)への機械充填で、
**適用は `scripts/install_workbench.py` が行う**(手貼り不要。下のコードは充填内容の正本)。
kit の `install_kit.py` は版上げ時に区画の中身を引き継ぐため、充填は更新で消えない:

1. **Python 実行**: `scripts/dev.py` の COMMANDS(加算形)へ次を充填し、
   スキル検索は `uv run scripts/dev.py design "<query>"` の動詞で呼ぶ
   (「Python は必ず uv 経由」kit GUARDRAILS §7.1。読み替え規約でなく動詞レールにする。
   uv 直呼びでの動作は確認済み):
   ```python
   COMMANDS.update({
       "design": [["uv", "run", "python",
                   ".claude/skills/ui-ux-pro-max/scripts/search.py", "{args}"]],
   })
   ```
2. **kit 検査の除外**: `scripts/repo_scan.py` の BINDING 区画へ次を充填する。
   `GENERATED_PATTERNS` は「手編集禁止・索引/検査から除外」の意味論で、内容系検査
   (ヘッダー必須・print 直呼び・ログ被覆・テスト非決定等)と STRUCTURE.md 索引の
   両方から外れる(check_structure.py は生成物を読み込まない)。
   gitleaks(秘密検出)は除外されない——それが正しい挙動:
   ```python
   GENERATED_PATTERNS += [re.compile(r"^\.claude/skills/")]
   ```
3. **生成物の扱い**: 同じ BINDING 区画へ次を充填する。`--persist` が書く
   `design-system/` はデザイン決定の記録としてコミット対象:
   ```python
   GENERATED_PATTERNS += [re.compile(r"^design-system/")]
   ```

emilkowalski/skills 由来の5スキル(アニメーション/デザインエンジニアリング系)は
`upstream/ui-skills/` の submodule 参照(ベンダーコピーではない)。repo_scan の列挙は
`git ls-files`(親リポジトリの追跡ファイルのみ)なので submodule の中身は最初から
検査対象外——特別対応は不要。
