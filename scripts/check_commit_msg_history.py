# check_commit_msg_history.py — commit-msg段のHARD検査をCIでPR範囲に対して再生する
# (契約: GUARDRAILS.md §3.4・§5)
#
# 呼び出し（§7.1: 必ず uv 経由。CI の checks ジョブとローカルで同じ想定）:
#   uv run scripts/check_commit_msg_history.py --base <rev> [--head <rev>]
#     --base 既定 origin/main（CI は PR の base SHA を渡す）／--head 既定 HEAD
#   exit 0 = 全コミット合格（対象コミット0件を含む） / exit 1 = 違反あり / exit 2 = 内部エラー
#
# なぜ要るか（発覚の経緯——2026-07-08・G7/G10 是正と同時に発見）: check_commit_msg.py
# は commit-msg ステージのフックなので、`pre-commit install` していない環境（GitHub の
# Web UI 経由のコミット等）からは技術的に一切発火しない。CI の checks ジョブは
# `pre-commit run --all-files` を実行するが、これは既定で pre-commit ステージのみを
# 再生し、commit-msg ステージ（check-commit-msg）は含まれない
# （.github/workflows/guardrails-ci.yml 冒頭のコメント参照——pre-push ステージが
# 別ジョブ ts-test で明示的に再生されているのと非対称に、commit-msg ステージだけ
# CI に一切乗っていなかった）。本スクリプトは PR のコミット範囲を1つずつ一時 worktree
# へ再現し、check_commit_msg.py を無改造のまま再生することでこの抜け穴を塞ぐ
# （check_red_first.py と同じ「一時 worktree + 差し替え呼び出し」流儀を踏襲）。
#
# やること: base..head の各コミット（マージ除く）について、
#   ① 一時 worktree へ `git worktree add --detach <path> <sha>`
#   ② 親がいれば `git reset --soft <sha>~1` で「そのコミット時点のステージ済み差分」を
#      復元する（`git diff --cached` と `git show :path` / `HEAD:path` が、そのコミットが
#      実際に作られた瞬間の commit-msg フックから見えたのと同じ状態になる）。
#      親の無い初回コミットは reset せず素の worktree のまま——staged が空になり、
#      check_commit_msg.py 自身の契約（ステージ空は検査2〜4とも素通し）が自然に働く。
#   ③ そのコミットのメッセージ（`git log -1 --format=%B`）を一時ファイルへ書き出す
#   ④ check_commit_msg.py を worktree 内 cwd でサブプロセス実行（無改造で再利用）
#   ⑤ 非0 が1つでもあれば違反として1行報告し、全コミット処理後に exit 1
#
# 対象外・近似（§7.4）: マージコミットは対象外（commit-msg フック自体、マージコミットの
# メッセージは PASS_THROUGH_PREFIXES で素通しする契約と揃える）。本スクリプトは
# check_commit_msg.py の判定をそのまま再生するだけで、判定ロジック自体の重複は持たない
# （二重管理を避ける——変更は check_commit_msg.py 側だけで完結する）。

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import repo_scan as rs  # noqa: E402

TIMEOUT_SEC = 30  # 1コミットあたりの保険（ハングした検査を静かに待たない — G11）


def _git(root: Path, *args: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(["git", "-C", str(root), *args], capture_output=True, check=False)
    except OSError as exc:
        raise rs.ScanError(f"git を起動できない: {exc}")


def _git_ok(root: Path, *args: str) -> bytes:
    proc = _git(root, *args)
    if proc.returncode != 0:
        raise rs.ScanError(
            f"git {' '.join(args)} が失敗: {proc.stderr.decode('utf-8', 'replace').strip()}")
    return proc.stdout


def resolve_rev(root: Path, rev: str, role: str) -> str:
    proc = _git(root, "rev-parse", "--verify", "-q", f"{rev}^{{commit}}")
    if proc.returncode != 0:
        raise rs.ScanError(
            f"{role} を解決できない: {rev!r}（例: --base origin/main。"
            "CI では PR の base SHA を渡し、checkout は fetch-depth: 0 で全履歴を取る — §5）")
    return proc.stdout.decode("utf-8", "replace").strip()


def all_commits(root: Path, base: str, head: str) -> list[str]:
    """base..head のマージ以外のコミット（古い順）。"""
    out = _git_ok(root, "rev-list", "--no-merges", "--reverse", f"{base}..{head}")
    return [s for s in out.decode("utf-8", "replace").split() if s]


def has_parent(root: Path, sha: str) -> bool:
    return _git(root, "rev-parse", "--verify", "-q", f"{sha}^").returncode == 0


class CommitWorktree:
    """検証対象コミット1つ分の一時 worktree（リポジトリ直下・後片付けまで）。"""

    def __init__(self, root: Path, sha: str):
        self.root = root
        self.sha = sha
        self.tmp: Path | None = None
        self.path: Path | None = None

    def __enter__(self) -> Path:
        self.tmp = Path(tempfile.mkdtemp(prefix=".commit-msg-history-", dir=self.root))
        self.path = self.tmp / "wt"
        _git_ok(self.root, "worktree", "add", "--detach", "--quiet", str(self.path), self.sha)
        if has_parent(self.root, self.sha):
            _git_ok(self.path, "reset", "--soft", f"{self.sha}~1")
        return self.path

    def __exit__(self, *_exc) -> None:
        if self.path is not None:
            _git(self.root, "worktree", "remove", "--force", str(self.path))
        if self.tmp is not None:
            shutil.rmtree(self.tmp, ignore_errors=True)
        _git(self.root, "worktree", "prune")


def check_one(root: Path, sha: str) -> tuple[int, str]:
    """1コミットぶんcheck_commit_msg.pyを再生する。(exit code, stderr) を返す。"""
    with CommitWorktree(root, sha) as worktree:
        msg_file = worktree / ".commit-msg-history-msg.txt"
        message = _git_ok(root, "log", "-1", "--format=%B", sha)
        msg_file.write_bytes(message)
        script = root / "scripts" / "check_commit_msg.py"
        try:
            proc = subprocess.run(
                [sys.executable, str(script), str(msg_file)],
                capture_output=True, cwd=str(worktree), timeout=TIMEOUT_SEC,
            )
        except subprocess.TimeoutExpired:
            raise rs.ScanError(f"check_commit_msg.py が {TIMEOUT_SEC} 秒以内に返らない: {sha}")
        except OSError as exc:
            raise rs.ScanError(f"check_commit_msg.py を起動できない: {exc}")
        return proc.returncode, proc.stderr.decode("utf-8", "replace").strip()


def main(argv: list[str]) -> int:
    rs.reconfigure_stdio()
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--head", default="HEAD")
    args = parser.parse_args(argv)

    root = Path(
        subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, check=True)
        .stdout.decode("utf-8", "replace").strip()
    )
    base = resolve_rev(root, args.base, "--base")
    head = resolve_rev(root, args.head, "--head")

    commits = all_commits(root, base, head)
    if not commits:
        print("check-commit-msg-history: 対象コミット0件（合格）")
        return 0

    violations = 0
    for sha in commits:
        code, stderr = check_one(root, sha)
        if code == 2:
            raise rs.ScanError(f"check_commit_msg.py が内部エラー（{sha}）: {stderr}")
        if code != 0:
            violations += 1
            short = sha[:12]
            for line in (stderr.splitlines() or ["(詳細なし)"]):
                print(f"HARD:commit-msg-history {short}: {line}", file=sys.stderr)

    if violations:
        print(f"check-commit-msg-history: {violations}件のコミットで違反（コミット単位の再生 — §5）",
              file=sys.stderr)
        return 1
    print(f"check-commit-msg-history: {len(commits)}件のコミットすべて合格")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except rs.ScanError as exc:
        print(f"check_commit_msg_history: 内部エラー: {exc}", file=sys.stderr)
        sys.exit(2)
    except Exception as exc:
        print(f"check_commit_msg_history: 内部エラー: {exc!r}", file=sys.stderr)
        sys.exit(2)
