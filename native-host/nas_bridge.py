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


def handle_delete_file(message: dict) -> dict:
    """base配下のファイルを削除する(ブラウザで消えた/空になったノートを active/ から消す用)。
    既に無い場合も成功扱い(消したい結果は達成)。base の外へ出るパスは拒否。"""
    try:
        target = _safe_target(message["path"], message["filename"])
        if os.path.isfile(target):
            os.remove(target)
        return {"type": "delete-result", "ok": True}
    except (OSError, KeyError, ValueError) as exc:
        return {"type": "delete-result", "ok": False, "error": str(exc)}


# タブ(ブラウザ)とNAS active の世代同期(SPEC: ユーザー指示)。世代カウンタは data/generation.txt に
# 整数1つで持つ。ブラウザは「操作開始時に bump-generation で新世代=所有権を得て」、以後 active を
# 上書きしてよいのは NAS の世代==自分の世代のときだけ。NASの方が大きい=他セッションが新しい→pull。
GENERATION_REL = os.path.join("data", "generation.txt")


def _read_generation(base: str) -> int:
    """NAS上の現在の世代番号を読む(ファイル未作成・壊れは 0 とみなす)。"""
    try:
        with open(_safe_target(base, GENERATION_REL), "r", encoding="utf-8") as f:
            return int(f.read().strip() or "0")
    except (OSError, ValueError):
        return 0


def handle_read_generation(message: dict) -> dict:
    """NASの現在の世代番号を返す(ブラウザが自分の世代と比較して push/pull を決める)。"""
    try:
        base = message["path"]
        if not os.path.isdir(base):
            raise FileNotFoundError(f"base folder not found: {base!r}")
        return {"type": "generation-result", "ok": True, "generation": _read_generation(base)}
    except (OSError, KeyError, ValueError) as exc:
        return {"type": "generation-result", "ok": False, "error": str(exc)}


def handle_bump_generation(message: dict) -> dict:
    """世代番号を+1して新値を返す(ブラウザが操作開始時に呼び所有権を得る)。読取→+1→書込。"""
    try:
        base = message["path"]
        if not os.path.isdir(base):
            raise FileNotFoundError(f"base folder not found: {base!r}")
        target = _safe_target(base, GENERATION_REL)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        new_gen = _read_generation(base) + 1
        with open(target, "w", encoding="utf-8") as f:
            f.write(str(new_gen))
        return {"type": "generation-result", "ok": True, "generation": new_gen}
    except (OSError, KeyError, ValueError) as exc:
        return {"type": "generation-result", "ok": False, "error": str(exc)}


def handle_read_active(message: dict) -> dict:
    """active/ 直下の .md を全部(ファイル名+内容)返す(pull用: タブをNAS activeで上書きする)。
    active/ が無ければ空リスト。サブフォルダは対象外(active は <id>.md の平置き)。"""
    try:
        base = message["path"]
        active_dir = _safe_target(base, "active")
        files = []
        if os.path.isdir(active_dir):
            for name in sorted(os.listdir(active_dir)):
                full = os.path.join(active_dir, name)
                if name.endswith(".md") and os.path.isfile(full):
                    with open(full, "r", encoding="utf-8") as f:
                        files.append({"filename": name, "content": f.read()})
        return {"type": "read-active-result", "ok": True, "files": files}
    except (OSError, KeyError, ValueError) as exc:
        return {"type": "read-active-result", "ok": False, "error": str(exc)}


def handle_rebuild_index(message: dict) -> dict:
    """active/notes/*.md・日付フォルダ YYYY/M/D/*.md・履歴 年/月/日/*.txt から
    data/index.db を作り直す(タグ検索の索引更新)。"""
    try:
        counts = build_index(message["path"])
        return {
            "type": "rebuild-result",
            "ok": True,
            "notes": counts["notes"],
            "dateNotes": counts["date_notes"],
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


def handle_top_tags(message: dict) -> dict:
    """notes のタグを頻度降順で返す(検索UIの上位タグチップ用)。index.db が無ければ ok:false
    (先に rebuild-index が要る)。"""
    try:
        base = message["path"]
        limit = int(message.get("limit", 50))
        db_path = os.path.join(base, "data", "index.db")
        if not os.path.isfile(db_path):
            return {
                "type": "top-tags-result",
                "ok": False,
                "error": "index.db が無い(先に rebuild-index を実行)",
            }
        conn = sqlite3.connect(db_path)
        try:
            rows = conn.execute(
                "SELECT t.name, COUNT(*) c FROM note_tags nt JOIN tags t ON t.id=nt.tag_id"
                " GROUP BY t.name ORDER BY c DESC, t.name LIMIT ?",
                (limit,),
            ).fetchall()
        finally:
            conn.close()
        return {
            "type": "top-tags-result",
            "ok": True,
            "tags": [{"tag": r[0], "count": r[1]} for r in rows],
        }
    except (OSError, sqlite3.Error, KeyError, ValueError) as exc:
        return {"type": "top-tags-result", "ok": False, "error": str(exc)}


def _build_note_search_where(
    alias: str,
    join_table: str,
    join_id_col: str,
    tags: list,
    mode: str,
    text: str,
    date_from: str | None,
    date_to: str | None,
) -> tuple[list[str], list]:
    """notes/date_notesどちらのテーブルにも使う共通WHERE組み立て(タグ結合テーブル名/結合列名だけ違う)。"""
    where: list[str] = []
    params: list = []
    if tags:
        placeholders = ",".join("?" * len(tags))
        if mode == "or":
            where.append(
                f"{alias}.id IN (SELECT jt.{join_id_col} FROM {join_table} jt"
                f" JOIN tags t ON t.id=jt.tag_id WHERE t.name IN ({placeholders}))"
            )
            params += tags
        else:
            where.append(
                f"{alias}.id IN (SELECT jt.{join_id_col} FROM {join_table} jt"
                f" JOIN tags t ON t.id=jt.tag_id WHERE t.name IN ({placeholders})"
                f" GROUP BY jt.{join_id_col} HAVING COUNT(DISTINCT t.name)=?)"
            )
            params += [*tags, len(tags)]
    if text:
        where.append(f"{alias}.content LIKE ?")
        params.append(f"%{text}%")
    if date_from:
        where.append(f"{alias}.created_at >= ?")
        params.append(date_from)
    if date_to:
        where.append(f"{alias}.created_at < ?")  # 半開区間(< to)
        params.append(date_to)
    return where, params


def handle_search_notes(message: dict) -> dict:
    """notes(現在の.md)を対象に タグ(AND/OR)＋本文LIKE＋created_at半開区間 で検索する。
    期間(from/to)を指定した時は、日次アーカイブ(date_notes/date_note_tags。YYYY/M/D/<id>.md
    の日次コピー)も同条件で検索し結果へ合流させる——notes.created_atは「ノートの作成時刻」
    でしかなく、過去のある日に実在した内容を辿るには日次アーカイブのほうが正本のため
    (2026-07-16に日次アーカイブの索引だけ追加してクエリを繋ぎ忘れていた欠落の是正・
    2026-07-16再修正)。アーカイブ由来の行は archived_date(YYYY/M/D)を持つ(現行行はnull)。
    検索結果をノートへ貼り付けるため**本文(content)全文**も返す。index.db が無ければ ok:false。
    期間は半開区間(created_at >= from AND created_at < to)。from/to は ISO8601 文字列。"""
    try:
        base = message["path"]
        db_path = os.path.join(base, "data", "index.db")
        if not os.path.isfile(db_path):
            return {
                "type": "search-notes-result",
                "ok": False,
                "error": "index.db が無い(先に rebuild-index を実行)",
            }
        tags = message.get("tags", [])
        text = message.get("text", "")
        mode = message.get("mode", "and")
        date_from = message.get("from")
        date_to = message.get("to")
        limit = int(message.get("limit", 500))

        conn = sqlite3.connect(db_path)
        try:
            where, params = _build_note_search_where(
                "d", "note_tags", "note_id", tags, mode, text, date_from, date_to
            )
            clause = (" WHERE " + " AND ".join(where)) if where else ""
            rows = conn.execute(
                "SELECT d.id, d.title, d.created_at, d.content, substr(d.content, 1, 160)"
                f" FROM notes d{clause}"
                " ORDER BY d.created_at DESC LIMIT ?",
                [*params, limit],
            ).fetchall()
            result = [
                {
                    "note_id": r[0],
                    "title": r[1],
                    "created_at": r[2],
                    "content": r[3],
                    "snippet": r[4],
                    "archived_date": None,
                }
                for r in rows
            ]

            if date_from or date_to:
                awhere, aparams = _build_note_search_where(
                    "d", "date_note_tags", "date_note_id", tags, mode, text, date_from, date_to
                )
                aclause = (" WHERE " + " AND ".join(awhere)) if awhere else ""
                arows = conn.execute(
                    "SELECT d.note_id, d.title, d.created_at, d.content,"
                    " substr(d.content, 1, 160), d.date_path"
                    f" FROM date_notes d{aclause}"
                    " ORDER BY d.created_at DESC LIMIT ?",
                    [*aparams, limit],
                ).fetchall()
                result += [
                    {
                        "note_id": r[0],
                        "title": r[1],
                        "created_at": r[2],
                        "content": r[3],
                        "snippet": r[4],
                        "archived_date": r[5],
                    }
                    for r in arows
                ]
                # notes/date_notesの2クエリ分をマージしたので、作成日時降順で並べ直し
                # limitで切り直す(片方だけの時のLIMIT順序を壊さないため元々の並びは維持)。
                result.sort(key=lambda r: r["created_at"] or "", reverse=True)
                result = result[:limit]
        finally:
            conn.close()
        return {"type": "search-notes-result", "ok": True, "rows": result}
    except (OSError, sqlite3.Error, KeyError, ValueError) as exc:
        return {"type": "search-notes-result", "ok": False, "error": str(exc)}


HANDLERS = {
    "probe": handle_probe,
    "write-file": handle_write_file,
    "read-file": handle_read_file,
    "delete-file": handle_delete_file,
    "read-generation": handle_read_generation,
    "bump-generation": handle_bump_generation,
    "read-active": handle_read_active,
    "rebuild-index": handle_rebuild_index,
    "search": handle_search,
    "search-notes": handle_search_notes,
    "top-tags": handle_top_tags,
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
