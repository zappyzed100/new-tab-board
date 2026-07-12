# build_index.py — NAS上の notes/*.md (YAML front matter) から検索用SQLite index.db を再生成する
#
# 正本はあくまで .md ファイル。index.db は消えても本スクリプトで再生成できる(ユーザー設計)。
# アプリ(拡張機能)はこのdbを読まない——「アプリの外からSQLで検索したい」用途のための索引。
# 依存は標準ライブラリのみ(sqlite3)。front matterの形式は書き込み側(nasArchive.tsのyamlScalar)と
# 揃えてあるため、最小の自前パーサで読む(PyYAML不要)。
#
# 使い方: python build_index.py <NASフォルダ>
#   <NASフォルダ>/notes/*.md を読み、<NASフォルダ>/data/index.db を作り直す。
from __future__ import annotations

import glob
import os
import sqlite3
import sys


def _unquote(value: str) -> str:
    """yamlScalarが二重引用符で囲んだ値を戻す。囲まれていなければそのまま。"""
    v = value.strip()
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        return v[1:-1].replace('\\"', '"').replace("\\\\", "\\")
    return v


def parse_front_matter(text: str) -> tuple[dict, str]:
    """先頭の `---` ブロックをdictに、残りを本文にして返す。front matterが無ければ({}, text)。"""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    block = text[3:end].strip("\n")
    body = text[end + 4 :]
    if body.startswith("\n"):
        body = body[1:]
    if body.startswith("\n"):
        body = body[1:]

    meta: dict = {}
    lines = block.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("tags:"):
            rest = line[len("tags:") :].strip()
            if rest == "[]":
                meta["tags"] = []
            else:
                tags: list[str] = []
                i += 1
                while i < len(lines) and lines[i].lstrip().startswith("- "):
                    tags.append(_unquote(lines[i].lstrip()[2:]))
                    i += 1
                meta["tags"] = tags
                continue
        elif ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = _unquote(value)
        i += 1
    return meta, body


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        DROP TABLE IF EXISTS note_tags;
        DROP TABLE IF EXISTS tags;
        DROP TABLE IF EXISTS notes;
        CREATE TABLE notes (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            title TEXT,
            content TEXT,
            created_at TEXT,
            updated_at TEXT,
            source_note_id TEXT,
            generated_by TEXT
        );
        CREATE TABLE tags (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL
        );
        CREATE TABLE note_tags (
            note_id TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (note_id, tag_id)
        );
        """
    )


def build_index(nas_folder: str) -> int:
    """notes/*.md を読み、data/index.db を作り直す。取り込んだノート数を返す。"""
    notes_dir = os.path.join(nas_folder, "notes")
    data_dir = os.path.join(nas_folder, "data")
    os.makedirs(data_dir, exist_ok=True)
    db_path = os.path.join(data_dir, "index.db")

    conn = sqlite3.connect(db_path)
    try:
        create_schema(conn)
        tag_ids: dict[str, int] = {}
        count = 0
        for path in sorted(glob.glob(os.path.join(notes_dir, "*.md"))):
            with open(path, "r", encoding="utf-8") as f:
                meta, body = parse_front_matter(f.read())
            note_id = meta.get("id") or os.path.splitext(os.path.basename(path))[0]
            conn.execute(
                "INSERT OR REPLACE INTO notes"
                " (id, file_path, title, content, created_at, updated_at, source_note_id, generated_by)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    note_id,
                    path,
                    meta.get("title"),
                    body,
                    meta.get("created_at"),
                    meta.get("updated_at"),
                    meta.get("source_note_id"),
                    meta.get("generated_by"),
                ),
            )
            for tag in meta.get("tags", []):
                if tag not in tag_ids:
                    cur = conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag,))
                    if cur.lastrowid:
                        tag_ids[tag] = cur.lastrowid
                    else:
                        tag_ids[tag] = conn.execute(
                            "SELECT id FROM tags WHERE name = ?", (tag,)
                        ).fetchone()[0]
                conn.execute(
                    "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)",
                    (note_id, tag_ids[tag]),
                )
            count += 1
        conn.commit()
        return count
    finally:
        conn.close()


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python build_index.py <NASフォルダ>", file=sys.stderr)
        sys.exit(2)
    n = build_index(sys.argv[1])
    print(f"index.db を再生成しました: {n} 件のノートを取り込みました")


if __name__ == "__main__":
    main()
