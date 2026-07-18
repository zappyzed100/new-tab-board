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
    # bumpは呼び出し側が知っている現在値(expected)を渡し、一致すれば+1される。
    assert handle({"type": "bump-generation", "path": nas, "expected": 0})["generation"] == 1
    assert handle({"type": "bump-generation", "path": nas, "expected": 1})["generation"] == 2
    assert handle({"type": "read-generation", "path": nas})["generation"] == 2
    # ファイルに整数で永続化されている。
    with open(os.path.join(nas, "data", "generation.txt"), encoding="utf-8") as f:
        assert f.read().strip() == "2"


def test_generation_fails_for_missing_base(tmp_path) -> None:
    missing = str(tmp_path / "no-such-nas")
    for t in ("read-generation", "bump-generation"):
        res = handle({"type": t, "path": missing, "expected": 0})
        assert res["ok"] is False
        assert "error" in res


def test_bump_generation_rejects_stale_expected(tmp_path) -> None:
    # 2026-07-19: bump-generationはCAS(compare-and-swap)——複数タブが同時に開いている時、
    # 一方が既にbump済みの状態を知らないまま(=古いexpectedのまま)もう一方がbumpしようと
    # すると、無条件bumpでは所有権を奪い取れてしまい、そのタブが持つ古い(削除前の)ノート
    # 一覧がNASへ丸ごと書き戻される実害があった。expectedが現在値と不一致ならok:falseで
    # stale:true・現在値を返し、呼び出し側はまずpullしてから再試行する契約にする。
    nas = str(tmp_path)
    first = handle({"type": "bump-generation", "path": nas, "expected": 0})
    assert first == {"type": "generation-result", "ok": True, "generation": 1}
    # 別タブがまだ世代0のつもりでbumpしようとすると、現在値(1)と不一致でstale。
    stale = handle({"type": "bump-generation", "path": nas, "expected": 0})
    assert stale == {"type": "generation-result", "ok": False, "stale": True, "generation": 1}
    # stale失敗は世代を進めない(ファイルは1のまま)。
    assert handle({"type": "read-generation", "path": nas})["generation"] == 1


def test_read_generation_rounds_down_out_of_range_values(tmp_path) -> None:
    # 世代ファイルへ負値/非現実的な巨大値が書き込まれていた場合(手動編集・壊れ)は
    # 0として扱う(拡張側のNumberが精度を失う前に安全側へ丸める保険——ユーザー指摘)。
    nas = str(tmp_path)
    os.makedirs(os.path.join(nas, "data"), exist_ok=True)
    generation_path = os.path.join(nas, "data", "generation.txt")
    with open(generation_path, "w", encoding="utf-8") as f:
        f.write("99999999999999999999")  # 10**15を大きく超える異常値
    assert handle({"type": "read-generation", "path": nas})["generation"] == 0
    with open(generation_path, "w", encoding="utf-8") as f:
        f.write("-5")
    assert handle({"type": "read-generation", "path": nas})["generation"] == 0


def test_read_active_returns_all_txt_with_content(tmp_path) -> None:
    # 2026-07-16: active/の拡張子を.mdから.txtへ変更(スマホのDriveアプリ/テキストビューアでの
    # 閲覧性を優先——ユーザー指示。中身の形式は無変更)。
    nas = str(tmp_path)
    handle({"type": "write-file", "path": nas, "filename": "active/n1.txt", "content": "本文1"})
    handle({"type": "write-file", "path": nas, "filename": "active/n2.txt", "content": "本文2"})
    # active直下でない/非.txtは対象外。
    handle({"type": "write-file", "path": nas, "filename": "active/sub/n3.txt", "content": "x"})
    handle({"type": "write-file", "path": nas, "filename": "active/note.md", "content": "y"})
    res = handle({"type": "read-active", "path": nas})
    assert res["ok"] is True
    assert res["files"] == [
        {"filename": "n1.txt", "content": "本文1"},
        {"filename": "n2.txt", "content": "本文2"},
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
    # notes由来の行は archived_date が無い(None)。
    assert all(r["archived_date"] is None for r in res_date["rows"])


def _write_date_note(nas: str, date_path: str, nid: str, title: str, tags: list, created: str, body: str) -> None:
    """統一構造の日付フォルダ(YYYY/M/D/<id>.md)へ1件書く。"""
    date_dir = os.path.join(nas, *date_path.split("/"))
    os.makedirs(date_dir, exist_ok=True)
    tag_lines = "".join(f"  - {t}\n" for t in tags)
    with open(os.path.join(date_dir, f"{nid}.md"), "w", encoding="utf-8") as f:
        f.write(f"---\nid: {nid}\ntitle: {title}\ntags:\n{tag_lines}created_at: {created}\n---\n\n{body}")


def test_search_notes_with_date_range_also_finds_date_archive(tmp_path) -> None:
    # 期間を指定した検索は、現行notesだけでなく日次アーカイブ(date_notes。過去の日付
    # フォルダのコピー)も対象にする——現行ボードから既に削除された/大きく編集された
    # ノートでも、過去のある日に実在した内容を見つけられる(2026-07-16 欠落の是正:
    # date_notesの索引は先に追加していたが、search-notesが一度もSELECTしていなかった)。
    nas = str(tmp_path)
    _seed_notes_for_search(nas)  # notes/*.md: 登山計画(07-01)・買い物(07-10)・登山メモ(08-05)
    # 現行ボードには残っていない、過去にだけ実在したノート(アーカイブ限定)。
    _write_date_note(
        nas, "2026/7/15", "d" + "0" * 35, "廃止済みノート", ["登山"], "2026-07-15T00:00:00.000Z", "もう無いノート"
    )
    handle({"type": "rebuild-index", "path": nas})

    res = handle(
        {
            "type": "search-notes",
            "path": nas,
            "from": "2026-07-01T00:00:00.000Z",
            "to": "2026-08-01T00:00:00.000Z",
        }
    )
    assert res["ok"] is True
    titles = {r["title"] for r in res["rows"]}
    # 現行notes分(登山計画・買い物)に加えて、アーカイブ限定の「廃止済みノート」も出る。
    assert titles == {"登山計画", "買い物", "廃止済みノート"}
    archived = next(r for r in res["rows"] if r["title"] == "廃止済みノート")
    assert archived["archived_date"] == "2026/7/15"
    assert archived["content"] == "もう無いノート"

    # タグ絞り込みと組み合わせても、アーカイブ側のタグ結合(date_note_tags)で正しく引ける。
    res_tag = handle(
        {
            "type": "search-notes",
            "path": nas,
            "tags": ["登山"],
            "from": "2026-07-01T00:00:00.000Z",
            "to": "2026-08-01T00:00:00.000Z",
        }
    )
    assert {r["title"] for r in res_tag["rows"]} == {"登山計画", "廃止済みノート"}


def test_search_notes_without_date_range_does_not_query_archive(tmp_path) -> None:
    # 期間未指定なら従来どおりnotesだけを検索する(アーカイブは日毎に大量の行を持ちうるため、
    # 期間を絞らない検索へ毎回合流させると同じノートが何件も重複して出てしまう)。
    nas = str(tmp_path)
    _seed_notes_for_search(nas)
    _write_date_note(
        nas, "2026/7/15", "d" + "0" * 35, "廃止済みノート", [], "2026-07-15T00:00:00.000Z", "もう無いノート"
    )
    handle({"type": "rebuild-index", "path": nas})

    res = handle({"type": "search-notes", "path": nas, "text": "もう無い"})
    assert res["ok"] is True
    assert res["rows"] == []


def test_search_notes_without_index_returns_error(tmp_path) -> None:
    res = handle({"type": "search-notes", "path": str(tmp_path), "text": "x"})
    assert res["ok"] is False
    assert "index.db" in res["error"]


def test_list_tree_lists_md_and_txt_recursively(tmp_path) -> None:
    # special/は.md、active/は.txt(2026-07-16〜)と呼び出し元によって拡張子が違うため、
    # list-treeは両方を対象にする(subdir名では分岐しない汎用列挙——nas_bridge.pyのコメント参照)。
    lib = os.path.join(str(tmp_path), "library", "仕事", "2026")
    os.makedirs(lib, exist_ok=True)
    with open(os.path.join(lib, "計画.md"), "w", encoding="utf-8") as f:
        f.write("# 計画")
    with open(os.path.join(str(tmp_path), "library", "メモ.md"), "w", encoding="utf-8") as f:
        f.write("メモ")
    with open(os.path.join(str(tmp_path), "library", "会議.txt"), "w", encoding="utf-8") as f:
        f.write("会議メモ")
    # .md/.txt 以外は無視
    with open(os.path.join(str(tmp_path), "library", "無視.json"), "w", encoding="utf-8") as f:
        f.write("{}")

    res = handle({"type": "list-tree", "path": str(tmp_path), "subdir": "library"})
    assert res["ok"] is True
    assert res["files"] == ["メモ.md", "仕事/2026/計画.md", "会議.txt"]


def test_list_tree_missing_folder_is_empty(tmp_path) -> None:
    res = handle({"type": "list-tree", "path": str(tmp_path), "subdir": "library"})
    assert res == {"type": "list-tree-result", "ok": True, "files": []}


def test_unknown_message_type_returns_error() -> None:
    result = handle({"type": "something-else"})
    assert result["type"] == "error"
    assert "something-else" in result["error"]
