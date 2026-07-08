# guard_git_bypass.py — git の --no-verify/-n・SKIP=・--force/-f push・core.hooksPath 迂回、および非可逆な作業消失（rm -rf .git／dirty での reset --hard 等）を exit 2 でブロック（正本: GUARDRAILS.md §2）
#
# 呼び出し（PreToolUse: Bash。settings.json 側で `uv run python` 経由——§7.1）。
# PreToolUse(Bash) の仕様: ブロックできるのは exit 2 **だけ**（exit 1 含む他の非0は素通し）。
# したがって本フック内の想定外エラーもすべて exit 2 に倒す（fail-closed）——これが契約。
# 引用符の中身（コミットメッセージ等）は判定前に取り除くため、メッセージ文面に
# --no-verify という文字列が入っていても誤検知しない。
#
# v2.23（G11・言語移行）: 旧 bash 実装は1回の呼び出しで jq/grep/sed/tr が最大18回
# 起動し、Windows実機で約1000ms/回かかっていた（v2.22 で bash 組み込み構文へ書き換えて
# 約243ms/回まで縮めたが、jq・sed の2プロセスは残っていた）。JSON解析・正規表現・
# 引用符除去はすべて Python 標準ライブラリで完結するため子プロセスがゼロになり、
# 実測で約80〜120ms/回（コーパス全74行の並列再生で1.3〜2秒——旧bashの5〜8秒から
# 3〜5倍）。bash版にあった「jq 不在時の保守的経路」も不要になった（json は標準
# ライブラリで常に使えるため、精密経路が唯一の経路になる——分岐が1本減り誤りの余地も減る）。
# tests/guard_corpus.tsv 全74行で bash 版との完全一致を確認済み。
#
# 作業消失ガード（v2.5・Phase 14）は同一フック内の関数として実装する（プロセス数を
# 増やさない — G11）。対象は**非可逆な作業消失だけ**——汎用の危険コマンド一覧
# （誤検知の密集地帯）は採らない。ローカルDBの破壊は `reset` 1発で戻る設計（§12.2）
# なので対象外。dirty 条件付き規則の回帰再生はコーパスの前提列（tests/guard_corpus.tsv）。

from __future__ import annotations

import json
import os
import re
import subprocess
import sys


def _word(w: str) -> re.Pattern[str]:
    """単語境界の判定。bash の `\\b`（GNU grep 拡張）と違い、Python の re は
    POSIX/PCRE 系どちらでも `\\b` を素直にサポートするため、そのまま使ってよい
    （v2.22 で bash 側は MSYS2/Windows の `[[ =~ ]]` が `\\b` 非対応と判明し、
    POSIX標準クラスの自前実装が必要だった——Python では発生しない差）。"""
    return re.compile(rf"\b(?:{w})\b")


WORD_GIT = _word("git")
WORD_PRECOMMIT = _word("pre-commit")
WORD_UNINSTALL = _word("uninstall")
WORD_COMMIT_PUSH = _word("commit|push")
WORD_COMMIT = _word("commit")
WORD_PUSH = _word("push")
WORD_RESET = _word("reset")
WORD_CLEAN = _word("clean")
WORD_CHECKOUT = _word("checkout")
WORD_RESTORE = _word("restore")

RE_HOOKSPATH = re.compile("hookspath", re.IGNORECASE)
RE_SKIP = re.compile(r"(^|[;&|\s])SKIP=")
RE_NFLAG = re.compile(r"(^|\s)-[a-mo-zA-Z]*n[a-zA-Z]*(\s|$)")
RE_FFLAG = re.compile(r"(^|\s)-[a-eg-zA-Z]*f[a-zA-Z]*(\s|$)")
RE_RM_RF = re.compile(r"(^|[;&|\s])rm\s([^;&|]*\s)?-[a-zA-Z]*([rR][a-zA-Z]*f|f[a-zA-Z]*[rR])")
RE_GITDIR = re.compile(r"(^|[\s=/])\.git(/|\s|$)")
RE_GITDIR_QUOTED = re.compile("[\"']\\.git(/|[\"'])")
RE_CHECKOUT_TAIL = re.compile(r"\bcheckout\b[^;&|]*\s\.(\s|$)")
RE_RESTORE_TAIL = re.compile(r"\brestore\b[^;&|]*\s\.(\s|$)")
RE_STAGED = re.compile(r"--staged|(^|\s)-[a-zA-Z]*S")
RE_WORKTREE = re.compile(r"--worktree|(^|\s)-[a-zA-Z]*W")
QUOTE_STRIP = re.compile(r"'[^']*'|\"[^\"]*\"")


class Block(Exception):
    def __init__(self, reason: str, loss: bool = False):
        self.reason = reason
        self.loss = loss


def block(reason: str) -> None:
    raise Block(reason, loss=False)


def block_loss(reason: str) -> None:
    raise Block(reason, loss=True)


def worktree_dirty_or_unknown(project_dir: str) -> bool:
    """未コミットの作業があるか。判定不能（git 不在・リポジトリ外）はブロック側に倒す
    （fail-closed — §2）。クリーンなら False——dirty 条件付き規則は素通しになる。"""
    try:
        proc = subprocess.run(
            ["git", "-C", project_dir, "status", "--porcelain"],
            capture_output=True, timeout=30,
        )
    except OSError:
        return True
    if proc.returncode != 0:
        return True
    return bool(proc.stdout.strip())


def check(cmd: str) -> None:
    no_newlines = cmd.replace("\n", " ")
    stripped = QUOTE_STRIP.sub("", no_newlines)

    # 全フック迂回: core.hooksPath の付け替え（`git config core.hooksPath …`・
    # `git -c core.hooksPath=…`）。フック本体ごと差し替えれば --no-verify 検査は
    # 無意味になるため、git を含むコマンドでの言及自体をブロックする
    # （キー名は git 仕様どおり大文字小文字非区別で判定・過剰ブロック側に倒す）。
    if WORD_GIT.search(stripped) and RE_HOOKSPATH.search(stripped):
        block("core.hooksPath の変更（フック本体の付け替え）")

    # 全フック迂回: pre-commit uninstall（シムの取り外し）。settings.json の deny は
    # 前方一致のみで `cd x && pre-commit uninstall`・`uvx pre-commit uninstall`・
    # `uv tool uninstall pre-commit` を通してしまう——引数順・経由の迂回を塞ぐのは
    # 主防壁の責務（--force と同じ二重構造）。
    if WORD_PRECOMMIT.search(stripped) and WORD_UNINSTALL.search(stripped):
        block("pre-commit uninstall（フックシムの取り外し）")

    if WORD_GIT.search(stripped) and WORD_COMMIT_PUSH.search(stripped):
        if "--no-verify" in stripped:
            block("--no-verify")
        if RE_SKIP.search(stripped):
            block("SKIP=")
        # git commit の -n / 結合短フラグ内の n も --no-verify の別名
        if WORD_COMMIT.search(stripped) and RE_NFLAG.search(stripped):
            block("-n (--no-verify の別名)")
        # force push（--force / --force-with-lease / -f / 結合短フラグ内の f）。
        # settings.json の deny は前方一致のみで、引数順を変えた `git push origin -f` を
        # 通してしまう——引数順の迂回を塞ぐのは主防壁であるこのフックの責務。
        if WORD_PUSH.search(stripped):
            if "--force" in stripped:
                block("--force push（--force-with-lease 含む。履歴を書き換えない）")
            if RE_FFLAG.search(stripped):
                block("-f (--force の別名)")

    # --- 作業消失ガード（§2・Phase 14 — v2.5）: 非可逆な作業消失だけを塞ぐ ---
    # ① `.git` を含む rm -rf は**常時**ブロック（履歴＝全作業の非可逆な破壊。履歴ごと
    #    消えたら guard もコーパスも無力）。フラグ検出は結合形（-rf/-fr/-Rf/-rvf 等）の
    #    近似——分離形 `rm -r -f` は §7.4「近似は仕様」の範囲外（実測されたらコーパスと
    #    同一コミットで還元する）。引用符で包んだ `.git` は stripped から消えるため、
    #    生コマンド側の引用付きトークンも併せて見る（過剰ブロック側に倒す — §2）。
    if RE_RM_RF.search(stripped):
        if RE_GITDIR.search(stripped) or RE_GITDIR_QUOTED.search(cmd):
            block_loss(".git を含む rm -rf（リポジトリ履歴の非可逆な破壊）は常時ブロック")

    # ② dirty 条件付き: 未コミットの作業がある時だけ、それを消すコマンドをブロックする。
    #    クリーンなら同じコマンドは無害なので素通し（dirty 条件が誤検知をほぼ消す）。
    #    広域判定の `.` は checkout/restore の**後**の単独トークンのみ（`git add .` 等の
    #    複合コマンドで誤検知しない）。`git restore --staged .` はインデックス操作のみで
    #    作業ツリーは無傷のため対象外（--worktree / -W を伴えば対象）。
    if WORD_GIT.search(stripped):
        wipe = ""
        if WORD_RESET.search(stripped) and "--hard" in stripped:
            wipe = "git reset --hard"
        elif WORD_CLEAN.search(stripped) and ("--force" in stripped or RE_FFLAG.search(stripped)):
            wipe = "git clean -f"
        elif WORD_CHECKOUT.search(stripped) and RE_CHECKOUT_TAIL.search(stripped):
            wipe = "広域の git checkout -- ."
        elif WORD_RESTORE.search(stripped) and RE_RESTORE_TAIL.search(stripped):
            if RE_STAGED.search(stripped) and not RE_WORKTREE.search(stripped):
                wipe = ""  # --staged のみ＝インデックス操作。作業ツリーの消失ではない
            else:
                wipe = "広域の git restore ."
        if wipe and worktree_dirty_or_unknown(os.environ.get("CLAUDE_PROJECT_DIR", ".")):
            block_loss(f"未コミット作業がある状態での {wipe}（非可逆な作業消失。"
                       "クリーンなツリーなら素通しになる）")


def main() -> int:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    raw = sys.stdin.read()
    if not raw:
        return 0
    payload = json.loads(raw) if raw.strip() else {}
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    if not cmd:
        return 0
    try:
        check(cmd)
    except Block as b:
        prefix = (
            f"ブロック: {b.reason}（GUARDRAILS.md §2 作業消失ガード）。消してよい変更なら"
            "先に commit / stash で退避するのが正規経路。人間の指示によるものなら、その旨を"
            "人間に確認してから人間側の端末で実行する。"
            if b.loss else
            f"ブロック: {b.reason} によるフック迂回は禁止（GUARDRAILS.md §2）。フックが"
            "落ちるなら迂回せず違反そのものを直すこと。2回連続で同じフックが落ちるなら"
            "原因調査に切り替える（ルート AGENTS.md §10-4）。"
        )
        print(prefix, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # fail-closed（§2の契約——想定外エラーも exit 2）
        print(f"guard_git_bypass: フック内部エラーのため fail-closed でブロック"
              f"（GUARDRAILS.md §2）: {exc!r}", file=sys.stderr)
        sys.exit(2)
