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
import struct
import sys


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


def handle_write_file(message: dict) -> dict:
    try:
        target = os.path.join(message["path"], message["filename"])
        with open(target, "w", encoding="utf-8") as f:
            f.write(message["content"])
        return {"type": "write-result", "ok": True}
    except (OSError, KeyError) as exc:
        return {"type": "write-result", "ok": False, "error": str(exc)}


def handle_read_file(message: dict) -> dict:
    try:
        target = os.path.join(message["path"], message["filename"])
        with open(target, "r", encoding="utf-8") as f:
            content = f.read()
        return {"type": "read-result", "ok": True, "content": content}
    except (OSError, KeyError) as exc:
        return {"type": "read-result", "ok": False, "error": str(exc)}


HANDLERS = {
    "probe": handle_probe,
    "write-file": handle_write_file,
    "read-file": handle_read_file,
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
