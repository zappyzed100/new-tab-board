# test_repo_scan_orphans.py — 孤立ファイル検出(orphan-file)の回帰テスト
#
# GUARDRAILS.md 運用ルール(v2.26・G7): _ts_import_targets は行頭アンカーの静的
# import/export しか拾わず、`const Notepad = lazy(() => import("./X"))` のように
# 動的 import() が行の途中に来る形を取りこぼしていた。Prettier が改行を入れるか
# どうか(=変数名の長さ)という無関係な事情で検出結果が変わるバグだった。
# また .d.ts アンビエント型宣言ファイルは import されずに tsconfig の include 経由で
# 効くのが正常だが、孤立ファイル検査の除外対象(is_test_file/is_generated)に
# 含まれておらず誤検知していた。
# 実行: uv run python tests/test_repo_scan_orphans.py
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import repo_scan as rs  # noqa: E402


class DynamicImportMidLineTest(unittest.TestCase):
    def test_single_line_dynamic_import_is_resolved(self) -> None:
        text = (
            'const Notepad = lazy(() => import("./components/notes/Notepad")'
            ".then((m) => ({ default: m.Notepad })));"
        )
        targets = rs._ts_import_targets("src/newtab/App.tsx", text, {})
        self.assertIn("src/newtab/components/notes/Notepad.tsx", targets)

    def test_wrapped_dynamic_import_is_still_resolved(self) -> None:
        text = (
            "const MarkdownPreview = lazy(() =>\n"
            '  import("./components/notes/MarkdownPreview").then((m) => ({ default: m.MarkdownPreview })),\n'
            ");"
        )
        targets = rs._ts_import_targets("src/newtab/App.tsx", text, {})
        self.assertIn("src/newtab/components/notes/MarkdownPreview.tsx", targets)

    def test_static_import_still_resolved(self) -> None:
        text = 'import { Clock } from "./components/shell/Clock";'
        targets = rs._ts_import_targets("src/newtab/App.tsx", text, {})
        self.assertIn("src/newtab/components/shell/Clock.tsx", targets)

    def test_package_import_not_treated_as_relative(self) -> None:
        text = 'import { useState } from "react";'
        targets = rs._ts_import_targets("src/newtab/App.tsx", text, {})
        self.assertEqual(targets, set())


class AmbientDeclarationTest(unittest.TestCase):
    def test_dts_file_is_recognized_as_ambient(self) -> None:
        self.assertTrue(rs.is_ambient_declaration("src/shims.d.ts"))

    def test_regular_ts_file_is_not_ambient(self) -> None:
        self.assertFalse(rs.is_ambient_declaration("src/lib/runtime/log.ts"))
        self.assertFalse(rs.is_ambient_declaration("src/newtab/components/notes/Notepad.tsx"))


if __name__ == "__main__":
    unittest.main()
