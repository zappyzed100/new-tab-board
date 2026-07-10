# test_check_structure_path_bindings.py — パス型バインディングの死活検査(path-binding-dead)の回帰テスト
#
# GUARDRAILS.md 運用ルール(v2.27・G9): binding-dead-patternは拡張子キーの辞書しか見ておらず、
# パスを値に持つバインディング(LOG_EXIT_FILES等の完全一致パス集合・PLAN_LAYER_ROOTS等の
# ディレクトリ接頭辞)がレイヤー直下の改名/削除でtracked filesに1件もマッチしなくなっても
# 検査が音もなく不発になる穴があった(新設のcheck_path_binding_dead_patternsが塞ぐ)。
# 実行: uv run python tests/test_check_structure_path_bindings.py
from __future__ import annotations

import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import repo_scan as rs  # noqa: E402
import check_structure as cs  # noqa: E402


def _run(tracked: set[str], **overrides: object) -> list[cs.Finding]:
    """5つのパス型バインディングすべてを安全な既定値(何も検出されない状態)に固定し、
    overridesで渡した分だけ差し替えてcheck_path_binding_dead_patternsを実行する
    (1テストにつき1つの binding だけを動かして相互汚染を避けるため)。"""
    defaults: dict[str, object] = {
        "LOG_EXIT_FILES": set(),
        "BINDING_STAMP_FILES": [],
        "PLAN_LAYER_ROOTS": [],
        "LOG_EXIT_PREFIXES": (),
        "DIR_COUNT_EXEMPT": (),
    }
    defaults.update(overrides)
    findings: list[cs.Finding] = []
    with ExitStack() as stack:
        for name, value in defaults.items():
            stack.enter_context(mock.patch.object(rs, name, value))
        cs.check_path_binding_dead_patterns(tracked, findings)
    return findings


class PathBindingDeadTest(unittest.TestCase):
    def test_log_exit_files_pointing_to_missing_file_is_flagged(self) -> None:
        findings = _run({"src/lib/runtime/clock.ts"}, LOG_EXIT_FILES={"src/lib/log.ts"})
        self.assertTrue(any("LOG_EXIT_FILES" in f[2] for f in findings))

    def test_log_exit_files_pointing_to_existing_file_is_not_flagged(self) -> None:
        findings = _run(
            {"src/lib/runtime/log.ts"}, LOG_EXIT_FILES={"src/lib/runtime/log.ts"}
        )
        self.assertEqual(findings, [])

    def test_binding_stamp_file_pointing_to_missing_file_is_flagged(self) -> None:
        findings = _run({"README.md"}, BINDING_STAMP_FILES=["scripts/repo_scan.py"])
        self.assertTrue(any("BINDING_STAMP_FILES" in f[2] for f in findings))

    def test_renamed_layer_root_prefix_is_flagged(self) -> None:
        # "lib/foo.ts" のみ = "src/" 配下が1件も無い(レイヤーが改名された想定)
        findings = _run({"lib/foo.ts"}, PLAN_LAYER_ROOTS=["src"])
        self.assertTrue(
            any("PLAN_LAYER_ROOTS" in f[2] for f in findings),
            "改名でsrc/配下が消えたのに検査が無反応だった",
        )

    def test_existing_layer_root_prefix_is_not_flagged(self) -> None:
        findings = _run({"src/lib/foo.ts"}, PLAN_LAYER_ROOTS=["src"])
        self.assertEqual(findings, [])

    def test_dir_count_exempt_prefix_is_flagged_when_missing(self) -> None:
        findings = _run({"README.md"}, DIR_COUNT_EXEMPT=("", "scripts"))
        detail = [f for f in findings if "DIR_COUNT_EXEMPT" in f[2]]
        self.assertTrue(detail)  # "scripts"配下が無いので検出される

    def test_empty_string_dir_count_exempt_is_never_flagged(self) -> None:
        # "" はルート直下を表す特別扱い(常にファイルがあるはずなので対象外)
        findings = _run({"README.md"}, DIR_COUNT_EXEMPT=("",))
        self.assertEqual(findings, [])

    def test_unfilled_columns_stay_silent(self) -> None:
        """列充填前の空リスト/集合は正常な初期状態——regressionではないので検出しない。"""
        findings = _run({"README.md"})
        self.assertEqual(findings, [])


if __name__ == "__main__":
    unittest.main()
