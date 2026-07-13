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


def test_delete_file_removes_and_missing_is_ok(tmp_path) -> None:
    nas = str(tmp_path)
    handle({"type": "write-file", "path": nas, "filename": "active/x.md", "content": "本文"})
    assert os.path.isfile(os.path.join(nas, "active", "x.md"))
    # 削除できる。
    res = handle({"type": "delete-file", "path": nas, "filename": "active/x.md"})
    assert res == {"type": "delete-result", "ok": True}
    assert not os.path.exists(os.path.join(nas, "active", "x.md"))
    # 既に無いファイルの削除も成功扱い。
    assert handle({"type": "delete-file", "path": nas, "filename": "active/x.md"})["ok"] is True


def test_delete_file_rejects_path_traversal(tmp_path) -> None:
    res = handle({"type": "delete-file", "path": str(tmp_path), "filename": "../escape.md"})
    assert res["ok"] is False
    assert "error" in res


def test_generation_starts_at_zero_and_bumps(tmp_path) -> None:
    nas = str(tmp_path)
    # 未作成なら世代0。
    assert handle({"type": "read-generation", "path": nas}) == {
        "type": "generation-result",
        "ok": True,
        "generation": 0,
    }
    # bumpするたびに+1され、read-generationにも反映される。
    assert handle({"type": "bump-generation", "path": nas})["generation"] == 1
    assert handle({"type": "bump-generation", "path": nas})["generation"] == 2
    assert handle({"type": "read-generation", "path": nas})["generation"] == 2
    # ファイルに整数で永続化されている。
    with open(os.path.join(nas, "data", "generation.txt"), encoding="utf-8") as f:
        assert f.read().strip() == "2"


def test_generation_fails_for_missing_base(tmp_path) -> None:
    missing = str(tmp_path / "no-such-nas")
    for t in ("read-generation", "bump-generation"):
        res = handle({"type": t, "path": missing})
        assert res["ok"] is False
        assert "error" in res


def test_read_active_returns_all_md_with_content(tmp_path) -> None:
    nas = str(tmp_path)
    handle({"type": "write-file", "path": nas, "filename": "active/n1.md", "content": "本文1"})
    handle({"type": "write-file", "path": nas, "filename": "active/n2.md", "content": "本文2"})
    # active直下でない/非.mdは対象外。
    handle({"type": "write-file", "path": nas, "filename": "active/sub/n3.md", "content": "x"})
    handle({"type": "write-file", "path": nas, "filename": "active/note.txt", "content": "y"})
    res = handle({"type": "read-active", "path": nas})
    assert res["ok"] is True
    assert res["files"] == [
        {"filename": "n1.md", "content": "本文1"},
        {"filename": "n2.md", "content": "本文2"},
    ]


def test_read_active_empty_when_no_active_dir(tmp_path) -> None:
    res = handle({"type": "read-active", "path": str(tmp_path)})
    assert res == {"type": "read-active-result", "ok": True, "files": []}


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


def _seed_notes_for_search(nas: str) -> None:
    """検索用に notes/*.md を複数(タグ・created_at入り)で用意する。"""
    notes = os.path.join(nas, "notes")
    os.makedirs(notes, exist_ok=True)

    def write(nid: str, title: str, tags: list, created: str, body: str) -> None:
        tag_lines = "".join(f"  - {t}\n" for t in tags)
        with open(os.path.join(notes, f"{nid}.md"), "w", encoding="utf-8") as f:
            f.write(
                f"---\nid: {nid}\ntitle: {title}\ntags:\n{tag_lines}"
                f"created_at: {created}\n---\n\n{body}"
            )

    write("a" + "0" * 35, "登山計画", ["登山", "計画"], "2026-07-01T00:00:00.000Z", "高尾山へ行く")
    write("b" + "0" * 35, "買い物", ["買い物"], "2026-07-10T00:00:00.000Z", "牛乳を買う")
    write("c" + "0" * 35, "登山メモ", ["登山"], "2026-08-05T00:00:00.000Z", "筑波山のメモ")


def test_top_tags_returns_by_frequency(tmp_path) -> None:
    nas = str(tmp_path)
    _seed_notes_for_search(nas)
    assert handle({"type": "rebuild-index", "path": nas})["ok"] is True

    res = handle({"type": "top-tags", "path": nas, "limit": 10})
    assert res["ok"] is True
    # 「登山」が2件で最頻。先頭に来る。
    assert res["tags"][0] == {"tag": "登山", "count": 2}
    names = {t["tag"] for t in res["tags"]}
    assert names == {"登山", "計画", "買い物"}


def test_search_notes_by_tag_and_or(tmp_path) -> None:
    nas = str(tmp_path)
    _seed_notes_for_search(nas)
    handle({"type": "rebuild-index", "path": nas})

    # AND: 登山かつ計画 → 登山計画のみ
    res_and = handle({"type": "search-notes", "path": nas, "tags": ["登山", "計画"], "mode": "and"})
    assert [r["title"] for r in res_and["rows"]] == ["登山計画"]
    # 本文全文が返る(貼り付け用)
    assert res_and["rows"][0]["content"] == "高尾山へ行く"

    # OR: 登山または買い物 → 3件
    res_or = handle({"type": "search-notes", "path": nas, "tags": ["登山", "買い物"], "mode": "or"})
    assert {r["title"] for r in res_or["rows"]} == {"登山計画", "買い物", "登山メモ"}


def test_search_notes_by_text_and_date_range(tmp_path) -> None:
    nas = str(tmp_path)
    _seed_notes_for_search(nas)
    handle({"type": "rebuild-index", "path": nas})

    # 本文LIKE
    res_text = handle({"type": "search-notes", "path": nas, "text": "高尾山"})
    assert [r["title"] for r in res_text["rows"]] == ["登山計画"]

    # 期間(半開区間): 2026-07 全体 → a(07-01)とb(07-10)、c(08-05)は含まない
    res_date = handle(
        {
            "type": "search-notes",
            "path": nas,
            "from": "2026-07-01T00:00:00.000Z",
            "to": "2026-08-01T00:00:00.000Z",
        }
    )
    assert {r["title"] for r in res_date["rows"]} == {"登山計画", "買い物"}


def test_search_notes_without_index_returns_error(tmp_path) -> None:
    res = handle({"type": "search-notes", "path": str(tmp_path), "text": "x"})
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
