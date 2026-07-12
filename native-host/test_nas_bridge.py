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


def _seed_notes_and_history(nas: str) -> None:
    notes = os.path.join(nas, "notes")
    os.makedirs(notes, exist_ok=True)
    note_id = "n1" + "0" * 34
    with open(os.path.join(notes, f"{note_id}.md"), "w", encoding="utf-8") as f:
        f.write("---\nid: %s\ntitle: 登山ノート\ntags:\n  - 登山\n---\n\n現在の本文" % note_id)
    hist = os.path.join(nas, "2026", "7", "12")
    os.makedirs(hist, exist_ok=True)
    snap = "s1" + "0" * 34
    with open(os.path.join(hist, f"{note_id}-1783830340293-{snap}.txt"), "w", encoding="utf-8") as f:
        f.write("過去の登山メモ。高尾山へ行った。")
    with open(os.path.join(hist, f"{note_id}-1783830999999-{snap[:-1]}9.txt"), "w", encoding="utf-8") as f:
        f.write("別の日の買い物メモ。牛乳を買う。")


def test_rebuild_index_then_search_by_tag_and_text(tmp_path) -> None:
    nas = str(tmp_path)
    _seed_notes_and_history(nas)

    rebuilt = handle({"type": "rebuild-index", "path": nas})
    assert rebuilt["ok"] is True
    assert rebuilt["snapshots"] == 2

    # 「登山」タグ かつ 本文に「高尾山」を含む履歴だけがヒットする
    res = handle({"type": "search", "path": nas, "tags": ["登山"], "text": "高尾山", "mode": "and"})
    assert res["ok"] is True
    assert len(res["rows"]) == 1
    assert res["rows"][0]["title"] == "登山ノート"
    assert "高尾山" in res["rows"][0]["snippet"]


def test_search_without_index_returns_error(tmp_path) -> None:
    res = handle({"type": "search", "path": str(tmp_path), "text": "x"})
    assert res["ok"] is False
    assert "index.db" in res["error"]


def test_list_tree_lists_md_recursively(tmp_path) -> None:
    lib = os.path.join(str(tmp_path), "library", "仕事", "2026")
    os.makedirs(lib, exist_ok=True)
    with open(os.path.join(lib, "計画.md"), "w", encoding="utf-8") as f:
        f.write("# 計画")
    with open(os.path.join(str(tmp_path), "library", "メモ.md"), "w", encoding="utf-8") as f:
        f.write("メモ")
    # .md 以外は無視
    with open(os.path.join(str(tmp_path), "library", "無視.txt"), "w", encoding="utf-8") as f:
        f.write("x")

    res = handle({"type": "list-tree", "path": str(tmp_path), "subdir": "library"})
    assert res["ok"] is True
    assert res["files"] == ["メモ.md", "仕事/2026/計画.md"]


def test_list_tree_missing_folder_is_empty(tmp_path) -> None:
    res = handle({"type": "list-tree", "path": str(tmp_path), "subdir": "library"})
    assert res == {"type": "list-tree-result", "ok": True, "files": []}


def test_unknown_message_type_returns_error() -> None:
    result = handle({"type": "something-else"})
    assert result["type"] == "error"
    assert "something-else" in result["error"]
