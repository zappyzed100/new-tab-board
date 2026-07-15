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
        DROP TABLE IF EXISTS date_note_tags;
        DROP TABLE IF EXISTS tags;
        DROP TABLE IF EXISTS notes;
        DROP TABLE IF EXISTS date_notes;
        DROP TABLE IF EXISTS snapshots;
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
        -- 新形式の日付フォルダ(NASの YYYY/M/D/<noteId>.md。writeNoteToNasStructureが書く
        -- active/<id>.md の日次コピー)。1ノートにつき「その日書かれた内容」が1行になるため
        -- 主キーは date_path+note_id の組み合わせ(2026-07-16 追加: 旧版はこの階層を索引していなかった)。
        CREATE TABLE date_notes (
            id TEXT PRIMARY KEY,
            note_id TEXT NOT NULL,
            date_path TEXT NOT NULL,
            file_path TEXT NOT NULL,
            title TEXT,
            content TEXT,
            created_at TEXT,
            updated_at TEXT
        );
        CREATE INDEX idx_date_notes_note_id ON date_notes (note_id);
        CREATE INDEX idx_date_notes_date_path ON date_notes (date_path);
        CREATE INDEX idx_date_notes_created_at ON date_notes (created_at);
        CREATE TABLE date_note_tags (
            date_note_id TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (date_note_id, tag_id)
        );
        -- 過去の履歴(NASの 年/月/日/*.txt スナップショット群。統一構造以前の旧形式)。
        -- 本文の部分一致検索(LIKE)用。
        CREATE TABLE snapshots (
            id TEXT PRIMARY KEY,
            note_id TEXT NOT NULL,
            timestamp INTEGER,
            file_path TEXT NOT NULL,
            content TEXT
        );
        CREATE INDEX idx_snapshots_note ON snapshots (note_id);
        """
    )


def parse_snapshot_filename(name: str):
    """履歴スナップショットのファイル名 `<noteId36>-<timestamp>-<snapshotId36>.txt` を分解する。
    UUIDは常に36文字なので固定幅で切り出す。形式が違えばNone。"""
    base = name[:-4] if name.endswith(".txt") else name
    if len(base) < 36 + 3 + 36:
        return None
    note_id = base[:36]
    snapshot_id = base[-36:]
    middle = base[36:-36]  # "-<timestamp>-"
    if not (middle.startswith("-") and middle.endswith("-")):
        return None
    ts_str = middle[1:-1]
    if not ts_str.isdigit():
        return None
    return note_id, int(ts_str), snapshot_id


def parse_date_note_path(nas_folder: str, path: str):
    """新形式の日付フォルダ(YYYY/M/D/<noteId>.md)かどうかを判定し、(date_path, note_id) を返す。
    年/月/日がすべて数字であることを確認する——`special/<フォルダ>/<サブフォルダ>/<id>.md`
    のような4階層になり得る非日付パス(スペシャルはネストしたフォルダを許すため)と誤って
    一致しないためのガード(parse_snapshot_filenameの.txt版と同じ「厳密に検証してから拾う」方針)。
    形式が違えばNone。"""
    rel = os.path.relpath(path, nas_folder).replace(os.sep, "/")
    parts = rel.split("/")
    if len(parts) != 4:
        return None
    year, month, day, filename = parts
    if not (year.isdigit() and month.isdigit() and day.isdigit()):
        return None
    if not filename.endswith(".md"):
        return None
    return f"{year}/{month}/{day}", filename[: -len(".md")]


def build_index(nas_folder: str) -> dict:
    """active/*.md(現在ブラウザにある非空ノートの正本。統一構造)・YYYY/M/D/*.md(日付フォルダの
    日次コピー。統一構造)・年/月/日/*.txt(統一構造以前の旧履歴)を読み、data/index.db を作り直す。
    取り込んだ件数 {"notes": n, "date_notes": d, "snapshots": m} を返す。
    旧構造 notes/*.md も残っていれば取り込む(移行期の後方互換。同id は active/ が上書き)。"""
    data_dir = os.path.join(nas_folder, "data")
    os.makedirs(data_dir, exist_ok=True)
    db_path = os.path.join(data_dir, "index.db")

    conn = sqlite3.connect(db_path)
    try:
        create_schema(conn)
        tag_ids: dict[str, int] = {}
        count = 0
        # 旧 notes/ を先に、新 active/ を後に読む(同id は active/ が上書き=最新の正本)。
        md_paths = sorted(glob.glob(os.path.join(nas_folder, "notes", "*.md"))) + sorted(
            glob.glob(os.path.join(nas_folder, "active", "*.md"))
        )
        seen_ids: set[str] = set()
        for path in md_paths:
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
            # 同idを再読込(active/がnotes/を上書き)する場合、古いタグ紐付けを一旦消してから
            # 現在のファイルのタグだけを張り直す(タグ更新が index に正しく反映される)。
            conn.execute("DELETE FROM note_tags WHERE note_id = ?", (note_id,))
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
            seen_ids.add(note_id)
        count = len(seen_ids)

        # 新形式の日付フォルダ(YYYY/M/D/<id>.md。writeNoteToNasStructureの日次コピー)を取り込む。
        # 1ノートにつき「その日書かれた内容」が1行になる(2026-07-16 追加: 従来は未索引だった)。
        date_note_count = 0
        for path in sorted(glob.glob(os.path.join(nas_folder, "*", "*", "*", "*.md"))):
            parsed = parse_date_note_path(nas_folder, path)
            if parsed is None:
                continue  # special/配下等、日付フォルダでない4階層.mdは対象外
            date_path, note_id_from_name = parsed
            with open(path, "r", encoding="utf-8") as f:
                meta, body = parse_front_matter(f.read())
            note_id = meta.get("id") or note_id_from_name
            row_id = f"{date_path}/{note_id}"
            conn.execute(
                "INSERT OR REPLACE INTO date_notes"
                " (id, note_id, date_path, file_path, title, content, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    row_id,
                    note_id,
                    date_path,
                    path,
                    meta.get("title"),
                    body,
                    meta.get("created_at"),
                    meta.get("updated_at"),
                ),
            )
            conn.execute("DELETE FROM date_note_tags WHERE date_note_id = ?", (row_id,))
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
                    "INSERT OR IGNORE INTO date_note_tags (date_note_id, tag_id) VALUES (?, ?)",
                    (row_id, tag_ids[tag]),
                )
            date_note_count += 1

        # 履歴スナップショット(年/月/日/*.txt)を取り込む。4階層グロブなので active/(2階層)とは衝突しない。
        snap_count = 0
        for path in sorted(glob.glob(os.path.join(nas_folder, "*", "*", "*", "*.txt"))):
            parsed = parse_snapshot_filename(os.path.basename(path))
            if parsed is None:
                continue
            note_id, ts, snapshot_id = parsed
            with open(path, "r", encoding="utf-8") as f:
                body = f.read()
            conn.execute(
                "INSERT OR REPLACE INTO snapshots (id, note_id, timestamp, file_path, content)"
                " VALUES (?, ?, ?, ?, ?)",
                (snapshot_id, note_id, ts, path, body),
            )
            snap_count += 1

        conn.commit()
        return {"notes": count, "date_notes": date_note_count, "snapshots": snap_count}
    finally:
        conn.close()


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python build_index.py <NASフォルダ>", file=sys.stderr)
        sys.exit(2)
    n = build_index(sys.argv[1])
    print(
        f"index.db を再生成しました: ノート{n['notes']}件・"
        f"日付フォルダ{n['date_notes']}件・履歴{n['snapshots']}件を取り込みました"
    )


if __name__ == "__main__":
    main()
