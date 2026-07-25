// tab-session.ts — 「このタブだけ」の一時設定の唯一の入出口(sessionStorage。GUARDRAILS.md §8.2)
//
// sessionStorage はタブ(トップレベル閲覧コンテキスト)ごとに独立し、リロードでは残り、タブを
// 閉じると消える——「タブ毎に切り替えたいが、そのタブでは再読込しても維持したい」設定に
// ちょうど合う。chrome.storage.local(=全タブ共有・永続)へ置くと、あるタブでの切替が
// 他のタブへ伝播してしまう(固定タグの選択がまさにこれだった)。
import { logOp } from "../runtime/log";

/** 固定タグモードで選択中のプリセットid(未選択は空文字)。 */
const FIXED_TAG_PRESET_KEY = "fixedTagPresetId";

export function readTabFixedTagPresetId(): string {
  try {
    return sessionStorage.getItem(FIXED_TAG_PRESET_KEY) ?? "";
  } catch (error) {
    // 読めない環境(ストレージ無効等)では「未選択」へ倒す——モードOFF=全件表示が安全側。
    logOp("tab-session", "read-failed", `key=${FIXED_TAG_PRESET_KEY} ${String(error)}`);
    return "";
  }
}

export function writeTabFixedTagPresetId(presetId: string): void {
  try {
    if (presetId === "") sessionStorage.removeItem(FIXED_TAG_PRESET_KEY);
    else sessionStorage.setItem(FIXED_TAG_PRESET_KEY, presetId);
  } catch (error) {
    // 書けなくても画面のstateは切り替わっている(リロードで戻るだけ)ので、操作は止めない。
    logOp("tab-session", "write-failed", `key=${FIXED_TAG_PRESET_KEY} ${String(error)}`);
  }
}
