# session_baseline.py — セッション開始時点の未コミット変更（人間のWIP）のパス集合を保存する（正本: GUARDRAILS.md §2c）
#
# SessionStart フック。`git status --porcelain` のパスを
# `.claude/session/<session_id>.baseline`（1行1パス・リポジトリ相対）へ書く。
# guard_human_wip.py（PreToolUse）がこの baseline を読み、「セッション開始時から
# 人間の手で dirty だったファイル」への AI の Edit/Write をブロックする（§2c）。
#
# 契約（§2c — fail-open 側）: SessionStart は exit 2 でもセッションを止めない仕様のため、
# 本フックの失敗は stderr 1行の表示＋exit 0（表示で「静かな不発」を防ぎ、進行は止めない。
# baseline が書けなかった場合、guard_human_wip.py 側も「baseline 不在＝警告1行で通す」）。
#
# 近似（§7.4 の流儀）: porcelain v1 のリネーム行 `XY old -> new` は両側のパスを保存する。
# core.quotePath による引用表記（非ASCIIパス等）は近似の範囲外——実測されたら
# guard_human_wip.py と同一コミットで直す。
#
# v2.23（G11・言語移行）: SessionStart は1セッション1回のみの発火（編集直後系ホット
# パスほど頻度は高くないが、他フックとの実装言語統一のため移植する）。

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

SESSION_ID_ALLOWED = re.compile(r"[^A-Za-z0-9._-]")


def warn_and_pass(reason: str) -> int:
    print(f"[session-baseline] {reason}（所有権ガード §2c は baseline 不在の警告付き"
          "素通しで縮退する）", file=sys.stderr)
    return 0


def resolve_root() -> str | None:
    root = os.environ.get("CLAUDE_PROJECT_DIR")
    if root:
        return root
    try:
        proc = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                               capture_output=True, timeout=30)
    except OSError:
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.decode("utf-8", "replace").strip()


def main() -> int:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    try:
        raw = sys.stdin.read()
    except OSError:
        return warn_and_pass("stdin を読めない")
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except ValueError:
        payload = {}

    root = resolve_root()
    if not root or not os.path.isdir(root):
        return warn_and_pass("リポジトリルートを解決できない")

    session_id_raw = payload.get("session_id") or ""
    session_id = SESSION_ID_ALLOWED.sub("", session_id_raw) or "unknown"

    try:
        proc = subprocess.run(["git", "-C", root, "status", "--porcelain"],
                              capture_output=True, timeout=30)
    except OSError:
        return warn_and_pass("git status が失敗")
    if proc.returncode != 0:
        return warn_and_pass("git status が失敗")
    porcelain = proc.stdout.decode("utf-8", "replace")

    baseline_dir = Path(root) / ".claude" / "session"
    baseline_file = baseline_dir / f"{session_id}.baseline"
    try:
        baseline_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return warn_and_pass("session ディレクトリを作れない")

    # 1行1パスに整形（`XY path`→path。リネーム `XY old -> new` は両側を1行ずつ）。
    # ツリーがクリーンでも**空の baseline を必ず書く**——「不在（不明）」と
    # 「開始時クリーン（保護対象なし）」を guard 側が区別できるようにする。
    lines: list[str] = []
    for raw_line in porcelain.splitlines():
        if not raw_line:
            continue
        path = raw_line[3:] if len(raw_line) > 3 else ""
        if " -> " in path:
            old, new = path.split(" -> ", 1)
            lines.append(old)
            lines.append(new)
        else:
            lines.append(path)

    try:
        with open(baseline_file, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines) + ("\n" if lines else ""))
    except OSError:
        return warn_and_pass("baseline を書けない")

    count = len(lines)
    if count > 0:
        print(f"[session-baseline] セッション開始時点の未コミット変更 {count} 件を記録した。"
              "これらのファイルへの Edit/Write は、人間が commit / stash するまでブロック"
              "される（GUARDRAILS.md §2c）", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # §2c は fail-open——想定外エラーも exit 0
        print(f"[session-baseline] 内部エラーのため素通し: {exc!r}"
              "（所有権ガード §2c は baseline 不在の警告付き素通しで縮退する）", file=sys.stderr)
        sys.exit(0)
