# test_session_baseline.py — session_baseline.py(SessionStartのsource分岐)の回帰テスト
#
# GUARDRAILS.md §2c(v2.25・G7): compact(要約)再発火時にAI自身の未コミット作業を
# 「人間のWIP」として誤ってbaselineへ上書きしてしまうバグの修正確認。
# 実行: uv run python tests/test_session_baseline.py
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOK = ROOT / ".claude" / "hooks" / "session_baseline.py"


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


def run_hook(repo: Path, payload: dict) -> None:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["CLAUDE_PROJECT_DIR"] = str(repo)
    proc = subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload).encode("utf-8"),
        capture_output=True,
        cwd=str(repo),
        env=env,
        timeout=10,
    )
    assert proc.returncode == 0, proc.stderr.decode("utf-8", "replace")


def baseline_path(repo: Path, session_id: str) -> Path:
    return repo / ".claude" / "session" / f"{session_id}.baseline"


class SessionBaselineTest(unittest.TestCase):
    def test_startup_writes_baseline_with_dirty_file(self) -> None:
        with tempfile.TemporaryDirectory(prefix="session-baseline-") as tmp:
            repo = make_repo(Path(tmp))
            (repo / "dirty.txt").write_text("uncommitted\n", encoding="utf-8")
            run_hook(repo, {"session_id": "s1", "source": "startup"})
            content = baseline_path(repo, "s1").read_text(encoding="utf-8")
            self.assertIn("dirty.txt", content)

    def test_compact_does_not_touch_existing_baseline(self) -> None:
        with tempfile.TemporaryDirectory(prefix="session-baseline-") as tmp:
            repo = make_repo(Path(tmp))
            baseline = baseline_path(repo, "s2")
            baseline.parent.mkdir(parents=True, exist_ok=True)
            baseline.write_text("BOOTSTRAP.md\n", encoding="utf-8")

            # compact再発火の瞬間、真のstartup時とは別のファイルがdirtyになっている
            # (AI自身の作業途中)状況を模する。
            (repo / "ai_wip.txt").write_text("mid-task\n", encoding="utf-8")
            run_hook(repo, {"session_id": "s2", "source": "compact"})

            self.assertEqual(baseline.read_text(encoding="utf-8"), "BOOTSTRAP.md\n")

    def test_compact_does_not_create_baseline_when_absent(self) -> None:
        with tempfile.TemporaryDirectory(prefix="session-baseline-") as tmp:
            repo = make_repo(Path(tmp))
            (repo / "ai_wip.txt").write_text("mid-task\n", encoding="utf-8")
            run_hook(repo, {"session_id": "s3", "source": "compact"})
            self.assertFalse(baseline_path(repo, "s3").exists())

    def test_resume_writes_baseline_normally(self) -> None:
        with tempfile.TemporaryDirectory(prefix="session-baseline-") as tmp:
            repo = make_repo(Path(tmp))
            (repo / "dirty.txt").write_text("uncommitted\n", encoding="utf-8")
            run_hook(repo, {"session_id": "s4", "source": "resume"})
            content = baseline_path(repo, "s4").read_text(encoding="utf-8")
            self.assertIn("dirty.txt", content)

    def test_missing_source_falls_back_to_writing(self) -> None:
        with tempfile.TemporaryDirectory(prefix="session-baseline-") as tmp:
            repo = make_repo(Path(tmp))
            (repo / "dirty.txt").write_text("uncommitted\n", encoding="utf-8")
            run_hook(repo, {"session_id": "s5"})
            content = baseline_path(repo, "s5").read_text(encoding="utf-8")
            self.assertIn("dirty.txt", content)


if __name__ == "__main__":
    unittest.main()
