# test_check_commit_msg.py — check_commit_msg.pyの検査2(fix-without-test)回帰テスト
#
# GUARDRAILS.md §3.4(v2.25・G7): 検査2(HARD)には検査6・8と同じ
# 「TEST_PATH_PATTERNS未充填なら不発」バイパスが無く、列充填前のリポジトリでは
# fix:コミットが原理上常に拒否される非対称バグがあった。その回帰テスト。
# 実行: uv run python tests/test_check_commit_msg.py
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
import check_commit_msg as ccm  # noqa: E402
import repo_scan as rs  # noqa: E402


def make_repo(tmp: Path) -> Path:
    d = tmp / "repo"
    d.mkdir()
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}

    def g(*args: str) -> None:
        proc = subprocess.run(["git", "-C", str(d), *args], capture_output=True, env=env)
        assert proc.returncode == 0, proc.stderr.decode("utf-8", "replace")

    g("init", "-q")
    g("config", "user.email", "test@example.invalid")
    g("config", "user.name", "test")
    g("config", "commit.gpgsign", "false")
    (d / "committed.txt").write_text("v1\n", encoding="utf-8")
    g("add", "committed.txt")
    g("commit", "-q", "-m", "init")
    return d


def run_in_repo(repo: Path, staged_name: str, staged_content: str, subject: str) -> int:
    """repo内でstaged_nameをステージし、subjectのメッセージファイルでmain()を呼ぶ。"""
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    (repo / staged_name).write_text(staged_content, encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", staged_name], capture_output=True, env=env, check=True)
    msg_file = repo / "MSG"
    msg_file.write_text(subject + "\n", encoding="utf-8")
    old_cwd = os.getcwd()
    os.chdir(repo)
    try:
        return ccm.main([str(msg_file)])
    finally:
        os.chdir(old_cwd)


class FixWithoutTestTest(unittest.TestCase):
    def test_unfilled_test_patterns_does_not_block_fix(self) -> None:
        with tempfile.TemporaryDirectory(prefix="check-commit-msg-") as tmp:
            repo = make_repo(Path(tmp))
            with mock.patch.object(rs, "TEST_PATH_PATTERNS", []):
                code = run_in_repo(repo, "app.ts", "export const x = 1;\n", "fix: 何かを直す")
            self.assertEqual(code, 0)

    def test_filled_test_patterns_still_blocks_fix_without_test(self) -> None:
        with tempfile.TemporaryDirectory(prefix="check-commit-msg-") as tmp:
            repo = make_repo(Path(tmp))
            patterns = [__import__("re").compile(r"\.test\.tsx?$")]
            with mock.patch.object(rs, "TEST_PATH_PATTERNS", patterns):
                code = run_in_repo(repo, "app.ts", "export const x = 1;\n", "fix: 何かを直す")
            self.assertEqual(code, 1)

    def test_filled_test_patterns_allows_fix_with_test(self) -> None:
        with tempfile.TemporaryDirectory(prefix="check-commit-msg-") as tmp:
            repo = make_repo(Path(tmp))
            patterns = [__import__("re").compile(r"\.test\.tsx?$")]
            with mock.patch.object(rs, "TEST_PATH_PATTERNS", patterns):
                code = run_in_repo(repo, "app.test.ts", "test('x', () => {});\n", "fix: 何かを直す")
            self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
