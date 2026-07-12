# test_build_index.py — build_index.py(notes/*.md → SQLite index.db 再生成)の単体テスト
from __future__ import annotations

import os
import sqlite3

from build_index import build_index, parse_front_matter, parse_snapshot_filename


def test_parse_front_matter_basic() -> None:
    text = (
        "---\n"
        "id: note-1\n"
        "title: タグ検索の設計\n"
        "tags:\n"
        "  - 開発\n"
        "  - 検索\n"
        "created_at: 2026-07-12T07:00:00.000Z\n"
        "---\n\n"
        "本文です。\n2行目。"
    )
    meta, body = parse_front_matter(text)
    assert meta["id"] == "note-1"
    assert meta["title"] == "タグ検索の設計"
    assert meta["tags"] == ["開発", "検索"]
    assert meta["created_at"] == "2026-07-12T07:00:00.000Z"
    assert body == "本文です。\n2行目。"


def test_parse_front_matter_quoted_and_empty_tags() -> None:
    text = '---\nid: n2\ntitle: "A: B #タグ"\ntags: []\n---\n\n本文'
    meta, body = parse_front_matter(text)
    assert meta["title"] == "A: B #タグ"  # 二重引用符を外す
    assert meta["tags"] == []
    assert body == "本文"


def test_parse_front_matter_none() -> None:
    meta, body = parse_front_matter("front matterの無いただの本文")
    assert meta == {}
    assert body == "front matterの無いただの本文"


def _write_note(notes_dir: str, name: str, content: str) -> None:
    os.makedirs(notes_dir, exist_ok=True)
    with open(os.path.join(notes_dir, name), "w", encoding="utf-8") as f:
        f.write(content)


def test_build_index_creates_db_and_tag_join(tmp_path) -> None:
    notes = str(tmp_path / "notes")
    _write_note(
        notes,
        "a.md",
        "---\nid: a\ntitle: 開発メモ\ntags:\n  - 開発\n  - 検索\n---\n\n本文A",
    )
    _write_note(
        notes,
        "b.md",
        "---\nid: b\ntitle: AIメモ\ntags:\n  - 開発\n  - AI\n---\n\n本文B",
    )

    result = build_index(str(tmp_path))
    assert result["notes"] == 2

    db = sqlite3.connect(str(tmp_path / "data" / "index.db"))
    try:
        # 「開発」タグのノートをJOINで引く
        rows = db.execute(
            "SELECT notes.title FROM notes"
            " JOIN note_tags ON notes.id = note_tags.note_id"
            " JOIN tags ON tags.id = note_tags.tag_id"
            " WHERE tags.name = '開発' ORDER BY notes.title"
        ).fetchall()
        assert [r[0] for r in rows] == ["AIメモ", "開発メモ"]
        # タグは重複せず1件ずつ
        assert db.execute("SELECT COUNT(*) FROM tags").fetchone()[0] == 3
        # 本文も入っている
        content = db.execute("SELECT content FROM notes WHERE id='a'").fetchone()[0]
        assert content == "本文A"
    finally:
        db.close()


def test_parse_snapshot_filename() -> None:
    note = "1e4b7a53-4693-45ee-89b0-57b42053608a"
    snap = "46af3516-b65d-4d66-ae01-b6f8b328f888"
    assert parse_snapshot_filename(f"{note}-1783830340293-{snap}.txt") == (note, 1783830340293, snap)
    # 形式が違うものはNone
    assert parse_snapshot_filename("notafile.txt") is None
    assert parse_snapshot_filename(f"{note}-notanumber-{snap}.txt") is None


def test_build_index_ingests_history_snapshots(tmp_path) -> None:
    # notes/(現在) と 年/月/日/*.txt(履歴) の両方を索引する
    notes = str(tmp_path / "notes")
    _write_note(notes, "a.md", "---\nid: n1\ntitle: 登山\ntags:\n  - 登山\n---\n\n現在の本文")
    hist_dir = str(tmp_path / "2026" / "7" / "12")
    os.makedirs(hist_dir, exist_ok=True)
    note = "n1" + "0" * 34  # 36文字のnote_id相当
    snap = "s1" + "0" * 34
    with open(os.path.join(hist_dir, f"{note}-1783830340293-{snap}.txt"), "w", encoding="utf-8") as f:
        f.write("過去の登山メモ。高尾山へ行った。")

    result = build_index(str(tmp_path))
    assert result["snapshots"] == 1

    db = sqlite3.connect(str(tmp_path / "data" / "index.db"))
    try:
        # 履歴本文の部分一致(LIKE)で引ける
        rows = db.execute(
            "SELECT note_id, timestamp FROM snapshots WHERE content LIKE '%高尾山%'"
        ).fetchall()
        assert rows == [(note, 1783830340293)]
        # active/ の2階層.txtは履歴として取り込まれない
        assert db.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 1
    finally:
        db.close()


def test_active_txt_not_indexed_as_snapshot(tmp_path) -> None:
    active = str(tmp_path / "active")
    os.makedirs(active, exist_ok=True)
    with open(os.path.join(active, "New Tab Board.txt"), "w", encoding="utf-8") as f:
        f.write("title: X\n\n本文")
    result = build_index(str(tmp_path))
    assert result["snapshots"] == 0


def test_build_index_is_regenerable(tmp_path) -> None:
    notes = str(tmp_path / "notes")
    _write_note(notes, "a.md", "---\nid: a\ntitle: 初回\ntags:\n  - x\n---\n\n本文")
    build_index(str(tmp_path))
    # .md を書き換えて再生成 → 古い状態が残らない
    _write_note(notes, "a.md", "---\nid: a\ntitle: 更新後\ntags:\n  - y\n---\n\n本文2")
    build_index(str(tmp_path))
    db = sqlite3.connect(str(tmp_path / "data" / "index.db"))
    try:
        assert db.execute("SELECT title FROM notes WHERE id='a'").fetchone()[0] == "更新後"
        names = [r[0] for r in db.execute("SELECT name FROM tags ORDER BY name").fetchall()]
        assert names == ["y"]  # 古いタグxは残らない
    finally:
        db.close()
