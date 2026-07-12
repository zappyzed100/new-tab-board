# test_nas_bridge.py — nas_bridge.py(NASブリッジnative messaging host)の単体テスト
from __future__ import annotations

import os

from nas_bridge import handle


def test_probe_success(tmp_path) -> None:
    result = handle({"type": "probe", "path": str(tmp_path)})
    assert result == {"type": "probe-result", "ok": True}
    # probe用の一時ファイルは後始末されている(NASフォルダにゴミを残さない)。
    assert not os.path.exists(os.path.join(str(tmp_path), ".new-tab-board-probe"))


def test_probe_failure_for_nonexistent_path(tmp_path) -> None:
    missing = str(tmp_path / "does-not-exist")
    result = handle({"type": "probe", "path": missing})
    assert result["type"] == "probe-result"
    assert result["ok"] is False
    assert "error" in result


def test_write_file_then_read_file_roundtrip(tmp_path) -> None:
    write_result = handle(
        {
            "type": "write-file",
            "path": str(tmp_path),
            "filename": "note.snapshot",
            "content": "こんにちは",
        }
    )
    assert write_result == {"type": "write-result", "ok": True}

    read_result = handle(
        {"type": "read-file", "path": str(tmp_path), "filename": "note.snapshot"}
    )
    assert read_result == {"type": "read-result", "ok": True, "content": "こんにちは"}


def test_write_file_failure_for_nonexistent_directory(tmp_path) -> None:
    missing = str(tmp_path / "does-not-exist")
    result = handle(
        {"type": "write-file", "path": missing, "filename": "x.snapshot", "content": "x"}
    )
    assert result["ok"] is False
    assert "error" in result


def test_read_file_failure_for_missing_file(tmp_path) -> None:
    result = handle(
        {"type": "read-file", "path": str(tmp_path), "filename": "missing.snapshot"}
    )
    assert result["ok"] is False
    assert "error" in result


def test_write_file_creates_date_subfolders(tmp_path) -> None:
    # filenameが 年/月/日 のサブフォルダ付きでも、親フォルダを自動生成して書ける。
    write_result = handle(
        {
            "type": "write-file",
            "path": str(tmp_path),
            "filename": "2026/7/12/n1-123-s1.txt",
            "content": "本文",
        }
    )
    assert write_result == {"type": "write-result", "ok": True}
    assert os.path.isfile(os.path.join(str(tmp_path), "2026", "7", "12", "n1-123-s1.txt"))

    read_result = handle(
        {"type": "read-file", "path": str(tmp_path), "filename": "2026/7/12/n1-123-s1.txt"}
    )
    assert read_result == {"type": "read-result", "ok": True, "content": "本文"}


def test_write_file_rejects_path_traversal(tmp_path) -> None:
    # ".." でベースフォルダの外へ抜けようとする書き込みは拒否する。
    result = handle(
        {
            "type": "write-file",
            "path": str(tmp_path),
            "filename": "../escape.txt",
            "content": "x",
        }
    )
    assert result["ok"] is False
    assert "error" in result
    assert not os.path.exists(os.path.join(os.path.dirname(str(tmp_path)), "escape.txt"))


def test_unknown_message_type_returns_error() -> None:
    result = handle({"type": "something-else"})
    assert result["type"] == "error"
    assert "something-else" in result["error"]
