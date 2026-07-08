# dev.py — ランタイム共通動詞のルーター: 全プロジェクト同名の動詞で環境を操作する（契約: GUARDRAILS.md §12.1）
#
# 呼び出し（§7.1: 必ず uv 経由）:
#   uv run scripts/dev.py verbs                 … 動詞一覧と配線状態を表示
#   uv run scripts/dev.py <動詞> [引数...]      … 例: up / reset / seed / time 2026-02-28T23:59 /
#                                                  test / e2e / fmt / check / probe "git push -f" /
#                                                  db "select 1"
#   exit = 実行したコマンドの終了コードをそのまま返す / 未配線の動詞 = exit 1 /
#   不明な動詞・引数不正 = exit 2（内部エラー扱い）
#
# 契約（§12.1）:
#   - 動詞の意味論は全プロジェクトで共通。配線（実コマンド）だけが列ごとに違う。
#   - 各動詞は冪等であること（冪等性は配線先コマンドの責務。up を2回叩いても壊れない）。
#   - 出力は `[dev] 動詞: コマンド` → 実行 → `[dev] 動詞: exit N (+Xms)`（ログ形式 — AGENTS.md §7）。
#   - COMMANDS が None の動詞は「未配線」を明示して落ちる（静かに何もしない fail-open の禁止）。
#
# BINDING-SOURCE: <列ID@版をここに>   ← Step 0 で刻印（§12.7）
#
# ===== BINDING: 動詞 → コマンド列（bindings/catalog.md の採用列から充填する）=====
# 値は「argv のリスト」のリスト（shell=False で順に実行・非0で中断 — §7.2）。
# 引数を受ける動詞は "{args}" トークンの位置に呼び出し引数が展開される。
# トークンが無いのに引数が来た場合は末尾に連結される。

from __future__ import annotations

import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import repo_scan as rs  # noqa: E402

ARGS_TOKEN = "{args}"

COMMANDS: dict[str, list[list[str]] | None] = {
    "up":    None,   # ローカル環境の起動（例: supabase start / docker compose up -d）
    "reset": None,   # 既知状態への復帰（DB reset + seed まで含めて1コマンド — §12.2）
    "seed":  None,   # シードデータ投入のみ（reset に含まれるなら同じ配線でよい）
    "time":  None,   # 時刻の凍結/解除（例: dev.py time 2026-02-28T23:59 / dev.py time clear）
    "test":  None,   # 単体テスト一式
    "e2e":   None,   # E2E（実UI貫通）テスト一式
    "fmt":   None,   # 整形（冪等）
    "check": [["uv", "run", "scripts/check_structure.py"]],   # 構造検査（言語なしで即動く）
    "probe": [["uv", "run", "scripts/check_guard_corpus.py", "--probe", "{args}"]],
             # ↑ 迂回防止の事前照会（言語なしで即動く — §2。「試して exit 2」の1周を削る）
    "db":    None,   # ローカルDBへの読み取りクエリ（例: dev.py db "select count(*) from x"）
}

VERB_HELP: dict[str, str] = {
    "up": "ローカル環境を起動する（冪等）",
    "reset": "環境を既知状態へ戻す（seed込み・決定性の供給 — §12.2）",
    "seed": "シードデータを投入する",
    "time": "アプリ内時刻を凍結/解除する（引数: ISO8601 または clear）",
    "test": "単体テストを実行する",
    "e2e": "E2Eテストを実行する（操作レール — §12.4）",
    "fmt": "コード整形を実行する（冪等）",
    "check": "構造検査を実行する（§3.3）",
    "probe": "コマンドが迂回防止（§2）に通るか事前照会する（引数: コマンド文字列1つ）",
    "db": "ローカルDBへ読み取りクエリを投げる（観察レール — §12.3）",
}


def _splice(cmd: list[str], args: list[str]) -> list[str]:
    if ARGS_TOKEN in cmd:
        out: list[str] = []
        for part in cmd:
            if part == ARGS_TOKEN:
                out.extend(args)
            else:
                out.append(part)
        return out
    return cmd + args if args else cmd


def _print_verbs() -> None:
    print("[dev] 動詞一覧（意味論は全プロジェクト共通・配線は bindings/catalog.md の採用列 — §12.1）")
    for verb in COMMANDS:
        wired = "配線済み" if COMMANDS[verb] else "未配線"
        print(f"  {verb:<6} {wired:<4}  {VERB_HELP.get(verb, '')}")


def main(argv: list[str]) -> int:
    rs.reconfigure_stdio()
    if not argv or argv[0] in ("-h", "--help", "verbs"):
        _print_verbs()
        return 0
    verb, args = argv[0], argv[1:]
    if verb not in COMMANDS:
        print(f"[dev] 不明な動詞: {verb!r}（`uv run scripts/dev.py verbs` で一覧 — §12.1）",
              file=sys.stderr)
        return 2
    cmds = COMMANDS[verb]
    if not cmds:
        print(f"[dev] {verb}: 未配線 — bindings/catalog.md の採用列の値を "
              "scripts/dev.py の COMMANDS へ充填する（§12.1。静かな不発は禁止）", file=sys.stderr)
        return 1
    root = rs.repo_root()
    for cmd in cmds:
        final = _splice(list(cmd), args)
        print(f"[dev] {verb}: {' '.join(final)}")
        # PATH 上のコマンド名は which で解決してから実行する（§7.2 の Windows 前提:
        # npx / prettier 等の .cmd/.bat ランチャーは shell=False の直呼びでは起動できず、
        # PATHEXT 込みで解決した実パスを渡す必要がある。未導入は明示エラー — fail-open 禁止）。
        if "/" not in final[0] and "\\" not in final[0]:
            resolved = shutil.which(final[0])
            if resolved is None:
                print(f"[dev] {verb}: コマンドが見つからない: {final[0]!r}"
                      "（導入は README / 採用列の「前提ツール」欄。PATH を確認する）",
                      file=sys.stderr)
                return 1
            final = [resolved, *final[1:]]
        started = time.monotonic()
        try:
            proc = subprocess.run(final, cwd=root)
        except OSError as exc:
            print(f"[dev] {verb}: 起動失敗 {exc}（コマンドの導入は README/採用列の前提ツール欄）",
                  file=sys.stderr)
            return 1
        elapsed = int((time.monotonic() - started) * 1000)
        print(f"[dev] {verb}: exit {proc.returncode} (+{elapsed}ms)")
        if proc.returncode != 0:
            return proc.returncode
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except rs.ScanError as exc:
        print(f"dev: 内部エラー: {exc}", file=sys.stderr)
        sys.exit(2)
    except KeyboardInterrupt:
        sys.exit(130)
    except BrokenPipeError:
        # 出力先が先に閉じた（`dev.py verbs | head` 等）。ツール自体のクラッシュ扱いにしない。
        import os
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
