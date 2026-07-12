# test_build_index.py — build_index.py(notes/*.md → SQLite index.db 再生成)の単体テスト
from __future__ import annotations

import os
import sqlite3

from build_index import build_index, parse_front_matter


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

    count = build_index(str(tmp_path))
    assert count == 2

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
