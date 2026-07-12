# nas_bridge.py — New Tab BoardのNASブリッジ native messaging host
#
# 拡張機能から標準入出力経由でJSONメッセージを受け取り、指定フォルダへファイルを
# 読み書きする(showDirectoryPicker()のChromium既知バグを回避するための本格対応。
# 契約: docs/nas-native-messaging-protocol.md)。
#
# Google公式のnative messaging Pythonサンプル(chrome-extensions-samples リポジトリの
# native-messaging-example-host)のメッセージ枠組み(4バイトリトルエンディアン長さ+
# UTF-8 JSON、Windowsでのバイナリモード設定)を下敷きにした最小実装。外部ライブラリ
# への依存は無い(標準ライブラリのみ)。
from __future__ import annotations

import json
import os
import sqlite3
import struct
import sys

from build_index import build_index


def read_message() -> dict | None:
    """1メッセージを読む。stdinが閉じられていたらNone(host終了の合図)。"""
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) < 4:
        return None
    length = struct.unpack("@I", raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode("utf-8"))


def send_message(message: dict) -> None:
    data = json.dumps(message).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("@I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def handle_probe(message: dict) -> dict:
    path = message.get("path", "")
    probe_path = os.path.join(path, ".new-tab-board-probe")
    try:
        with open(probe_path, "w", encoding="utf-8") as f:
            f.write("ok")
        with open(probe_path, "r", encoding="utf-8") as f:
            ok = f.read() == "ok"
        os.remove(probe_path)
        return {"type": "probe-result", "ok": ok}
    except OSError as exc:
        return {"type": "probe-result", "ok": False, "error": str(exc)}


def _safe_target(base: str, filename: str) -> str:
    """base配下の絶対パスへ解決する。filenameは "2026/7/12/foo.txt" のような
    サブフォルダ付き相対パスを許すが、".." 等でbaseの外へ出ることは拒否する
    (拡張機能側が渡すパスとはいえ、フォルダ外への書き込みを構造的に塞ぐ)。"""
    rel = os.path.normpath(filename.replace("\\", "/"))
    base_abs = os.path.abspath(base)
    target_abs = os.path.abspath(os.path.join(base_abs, rel))
    if os.path.commonpath([base_abs, target_abs]) != base_abs:
        raise ValueError(f"path escapes base folder: {filename!r}")
    return target_abs


def handle_write_file(message: dict) -> dict:
    try:
        base = message["path"]
        # NASベースフォルダ自体が無い(NAS未接続・パス誤り)場合は、幻のローカルフォルダを
        # でっち上げず失敗させる——年/月/日 のサブフォルダだけを既存ベースの下に自動生成する。
        if not os.path.isdir(base):
            raise FileNotFoundError(f"base folder not found: {base!r}")
        target = _safe_target(base, message["filename"])
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            f.write(message["content"])
        return {"type": "write-result", "ok": True}
    except (OSError, KeyError, ValueError) as exc:
        return {"type": "write-result", "ok": False, "error": str(exc)}


def handle_read_file(message: dict) -> dict:
    try:
        target = _safe_target(message["path"], message["filename"])
        with open(target, "r", encoding="utf-8") as f:
            content = f.read()
        return {"type": "read-result", "ok": True, "content": content}
    except (OSError, KeyError, ValueError) as exc:
        return {"type": "read-result", "ok": False, "error": str(exc)}


def handle_rebuild_index(message: dict) -> dict:
    """notes/*.md と履歴 年/月/日/*.txt から data/index.db を作り直す(タグ検索の索引更新)。"""
    try:
        counts = build_index(message["path"])
        return {
            "type": "rebuild-result",
            "ok": True,
            "notes": counts["notes"],
            "snapshots": counts["snapshots"],
        }
    except (OSError, sqlite3.Error, KeyError) as exc:
        return {"type": "rebuild-result", "ok": False, "error": str(exc)}


def handle_search(message: dict) -> dict:
    """タグで絞り込み→本文の部分一致(LIKE)で“履歴”を検索する(ブラウザからSQLは叩けないので
    Python側で実行し結果だけ返す)。tags(AND/OR)・text は任意。マッチした履歴スナップショットを
    新しい順で返す。index.dbが無ければ先にrebuild-indexが必要。"""
    try:
        base = message["path"]
        db_path = os.path.join(base, "data", "index.db")
        if not os.path.isfile(db_path):
            return {
                "type": "search-result",
                "ok": False,
                "error": "index.db が無い(先に rebuild-index を実行)",
            }
        tags = message.get("tags", [])
        text = message.get("text", "")
        mode = message.get("mode", "and")
        where: list[str] = []
        params: list = []
        if tags:
            placeholders = ",".join("?" * len(tags))
            if mode == "or":
                where.append(
                    "s.note_id IN (SELECT nt.note_id FROM note_tags nt"
                    f" JOIN tags t ON t.id=nt.tag_id WHERE t.name IN ({placeholders}))"
                )
                params += tags
            else:
                where.append(
                    "s.note_id IN (SELECT nt.note_id FROM note_tags nt"
                    f" JOIN tags t ON t.id=nt.tag_id WHERE t.name IN ({placeholders})"
                    " GROUP BY nt.note_id HAVING COUNT(DISTINCT t.name)=?)"
                )
                params += [*tags, len(tags)]
        if text:
            where.append("s.content LIKE ?")
            params.append(f"%{text}%")
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        conn = sqlite3.connect(db_path)
        try:
            rows = conn.execute(
                "SELECT s.note_id, n.title, s.timestamp, substr(s.content, 1, 160)"
                f" FROM snapshots s LEFT JOIN notes n ON n.id = s.note_id{clause}"
                " ORDER BY s.timestamp DESC LIMIT 200",
                params,
            ).fetchall()
        finally:
            conn.close()
        result = [
            {"note_id": r[0], "title": r[1], "timestamp": r[2], "snippet": r[3]} for r in rows
        ]
        return {"type": "search-result", "ok": True, "rows": result}
    except (OSError, sqlite3.Error, KeyError) as exc:
        return {"type": "search-result", "ok": False, "error": str(exc)}


def handle_list_tree(message: dict) -> dict:
    """subdir(例: "library")配下の .md ファイルを相対パスで再帰列挙する(ライブラリのツリー閲覧用)。
    フォルダが無ければ空リスト。baseの外へ出るsubdirは拒否。"""
    try:
        base = message["path"]
        subdir = message.get("subdir", "")
        root = _safe_target(base, subdir) if subdir else os.path.abspath(base)
        if not os.path.isdir(root):
            return {"type": "list-tree-result", "ok": True, "files": []}
        files = []
        for dirpath, _dirnames, filenames in os.walk(root):
            for name in filenames:
                if name.endswith(".md"):
                    rel = os.path.relpath(os.path.join(dirpath, name), root).replace("\\", "/")
                    files.append(rel)
        files.sort()
        return {"type": "list-tree-result", "ok": True, "files": files}
    except (OSError, KeyError, ValueError) as exc:
        return {"type": "list-tree-result", "ok": False, "error": str(exc)}


HANDLERS = {
    "probe": handle_probe,
    "write-file": handle_write_file,
    "read-file": handle_read_file,
    "rebuild-index": handle_rebuild_index,
    "search": handle_search,
    "list-tree": handle_list_tree,
}


def handle(message: dict) -> dict:
    handler = HANDLERS.get(message.get("type"))
    if handler is None:
        return {"type": "error", "error": f"unknown message type: {message.get('type')!r}"}
    return handler(message)


def main() -> None:
    if sys.platform == "win32":
        import msvcrt

        msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
        msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)

    while True:
        message = read_message()
        if message is None:
            break
        send_message(handle(message))


if __name__ == "__main__":
    main()
