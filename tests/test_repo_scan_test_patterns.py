# test_repo_scan_test_patterns.py — TEST_PATH_PATTERNSのキット自身デフォルトの回帰テスト
#
# GUARDRAILS.md 運用ルール(v2.25・G10): .claude/hooks/*.py・scripts/*.pyは採用列に関係なく
# 常にキット自身のPythonインフラであり、その回帰テスト(tests/test_*.py等)を
# is_test_file()が認識できないと、Python製の回帰テストを伴うfix:コミットが
# TEST_PATH_PATTERNS充填済みリポジトリでも常にfix-without-testで拒否される実害があった。
# 実行: uv run python tests/test_repo_scan_test_patterns.py
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import repo_scan as rs  # noqa: E402


class TestPathPatternsTest(unittest.TestCase):
    def test_python_kit_test_files_are_recognized(self) -> None:
        self.assertTrue(rs.is_test_file("tests/test_session_baseline.py"))
        self.assertTrue(rs.is_test_file("tests/foo_test.py"))
        self.assertTrue(rs.is_test_file("tests/nested/test_bar.py"))

    def test_non_test_python_files_are_not_recognized(self) -> None:
        self.assertFalse(rs.is_test_file(".claude/hooks/session_baseline.py"))
        self.assertFalse(rs.is_test_file("scripts/repo_scan.py"))

    def test_column_specific_ts_patterns_still_recognized(self) -> None:
        self.assertTrue(rs.is_test_file("src/lib/foo.test.ts"))
        self.assertTrue(rs.is_test_file("e2e/board.spec.ts"))
        self.assertFalse(rs.is_test_file("src/lib/foo.ts"))


if __name__ == "__main__":
    unittest.main()
