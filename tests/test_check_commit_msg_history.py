# test_check_commit_msg_history.py — check_commit_msg_history.pyの回帰テスト
#
# GUARDRAILS.md §3.4・§5(v2.25・G10): commit-msg段のHARD検査(check_commit_msg.py)は
# CIの`pre-commit run --all-files`(既定でpre-commitステージのみ再生)に一切乗っておらず、
# `pre-commit install`していない環境からのコミットには効かなかった。その回帰テスト:
# 一時リポジトリでPR範囲を模し、違反コミットが実際に検出されることを確認する。
# 実行: uv run python tests/test_check_commit_msg_history.py
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REAL_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import check_commit_msg_history as cmh  # noqa: E402


def make_repo(tmp: Path) -> Path:
    """scripts/(check_commit_msg.py・repo_scan.py)を持つ最小リポジトリを作る。

    check_commit_msg_history.pyはworktree内で`<root>/scripts/check_commit_msg.py`を
    サブプロセス起動するため、テスト用リポジトリにも実物と同じscripts/一式が要る。
    """
    d = tmp / "repo"
    (d / "scripts").mkdir(parents=True)
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}

    def g(*args: str) -> None:
        proc = subprocess.run(["git", "-C", str(d), *args], capture_output=True, env=env)
        assert proc.returncode == 0, proc.stderr.decode("utf-8", "replace")

    shutil.copy(SCRIPTS_DIR / "check_commit_msg.py", d / "scripts" / "check_commit_msg.py")
    shutil.copy(SCRIPTS_DIR / "repo_scan.py", d / "scripts" / "repo_scan.py")

    g("init", "-q")
    g("config", "user.email", "test@example.invalid")
    g("config", "user.name", "test")
    g("config", "commit.gpgsign", "false")
    g("add", "-A")
    g("commit", "-q", "-m", "chore: 初期コミット")
    return d


def commit(repo: Path, rel: str, content: str, message: str) -> None:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    (repo / rel).write_text(content, encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", rel], capture_output=True, env=env, check=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-q", "-m", message],
        capture_output=True, env=env, check=True,
    )


def run_history(repo: Path, base: str, head: str = "HEAD") -> int:
    old_cwd = os.getcwd()
    os.chdir(repo)
    try:
        return cmh.main(["--base", base, "--head", head])
    finally:
        os.chdir(old_cwd)


class CheckCommitMsgHistoryTest(unittest.TestCase):
    def test_all_valid_commits_pass(self) -> None:
        with tempfile.TemporaryDirectory(prefix="commit-msg-history-") as tmp:
            repo = make_repo(Path(tmp))
            base = subprocess.run(
                ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, check=True
            ).stdout.decode().strip()
            commit(repo, "a.test.ts", "test('x', () => {});\n", "fix: 何かを直す")
            commit(repo, "b.ts", "export const y = 2;\n", "feat: 何かを足す")
            self.assertEqual(run_history(repo, base), 0)

    def test_fix_without_test_is_caught(self) -> None:
        with tempfile.TemporaryDirectory(prefix="commit-msg-history-") as tmp:
            repo = make_repo(Path(tmp))
            base = subprocess.run(
                ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, check=True
            ).stdout.decode().strip()
            commit(repo, "a.ts", "export const x = 1;\n", "fix: テスト無しの修正")
            self.assertEqual(run_history(repo, base), 1)

    def test_no_commits_in_range_passes(self) -> None:
        with tempfile.TemporaryDirectory(prefix="commit-msg-history-") as tmp:
            repo = make_repo(Path(tmp))
            head = subprocess.run(
                ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, check=True
            ).stdout.decode().strip()
            self.assertEqual(run_history(repo, head, head), 0)


if __name__ == "__main__":
    unittest.main()
