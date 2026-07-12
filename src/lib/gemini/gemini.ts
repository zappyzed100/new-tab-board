// gemini.ts — Google Gemini API(generateContent)呼び出しの唯一の入出口
// タグ付け・要約・TODO抽出の各機能が共通で使う土台。APIキーはdb.tsの設定ストアに保存し
// (Drive/syncへ乗らない)、呼び出し側が読み出してこの関数へ渡す。無料枠のflashモデルを既定にする。
// ネットワークはfetchを依存注入で差し替え可能にし、テストは実APIを叩かずフェイクで検証する。
import { logOp } from "../runtime/log";
import { now as clockNow } from "../runtime/clock";
import { geminiUsageDateKey, recordGeminiUsage } from "../storage/db";

/** 既定モデル。ユーザー指示で Gemini 3.1 Flash Lite を採用(2026-07-13)。
 * ※APIのモデルIDが実機で異なる場合(404)はここだけ差し替える(呼び出し側はdeps.modelで上書き可)。 */
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

/** 1日の使用回数がこの値に達したら「GPT-OSS 120Bへ乗り換え」警告を出す(ユーザー指示)。 */
export const GEMINI_DAILY_WARN_THRESHOLD = 450;

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** 既定の使用量記録: 今日の日付キーで1回分を加算する(fire-and-forget。DB不可の環境では諦める)。 */
function defaultRecordUsage(): void {
  try {
    void recordGeminiUsage(geminiUsageDateKey(clockNow())).catch(() => {});
  } catch {
    // IndexedDB未利用環境(テスト等)では使用量記録を諦める——本体の呼び出しは止めない。
  }
}

/** 429(レート制限)を食らった後、次の呼び出しまで待つクールダウン。
 * 保存のたびに自動タグ付けがGeminiを叩くため、枠を超えたら一定時間fetch自体を止めて
 * 429エラーの連発と無駄な消費を防ぐ(Geminiの分単位RPM制限はこの程度で回復する)。 */
const RATE_LIMIT_COOLDOWN_MS = 60_000;
let rateLimitedUntil = 0;

/** テスト用: レート制限クールダウンをリセットする(モジュール状態のテスト間隔離)。 */
export function resetGeminiRateLimitForTests(): void {
  rateLimitedUntil = 0;
}

export type GeminiDeps = { fetch?: typeof fetch; model?: string; recordUsage?: () => void };

/** プロンプトを投げてテキスト応答を返す。失敗(キー未設定・HTTPエラー・例外・クールダウン中)はnull。
 * APIキーはURLのkeyクエリで渡す(Gemini APIの標準)。キー文字列自体はログに出さない(§7)。 */
export async function callGemini(
  prompt: string,
  apiKey: string,
  deps: GeminiDeps = {},
): Promise<string | null> {
  if (!apiKey) return null;
  // 直近で429を食らっていれば、クールダウン中はfetchせず静かに諦める(エラー連発を防ぐ)。
  if (Date.now() < rateLimitedUntil) {
    logOp("gemini", "skip-rate-limited", "cooldown中のためスキップ");
    return null;
  }
  const _fetch = deps.fetch ?? fetch;
  const model = deps.model ?? DEFAULT_GEMINI_MODEL;
  const recordUsage = deps.recordUsage ?? defaultRecordUsage;
  try {
    const res = await _fetch(
      `${API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    // 実際にAPIへ1リクエスト投げた=1回分の使用として記録する(成功/429を問わず消費のため)。
    recordUsage();
    if (!res.ok) {
      if (res.status === 429) {
        rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        logOp(
          "gemini",
          "rate-limited",
          `model=${model} 429; ${RATE_LIMIT_COOLDOWN_MS}msクールダウン`,
        );
      } else {
        logOp("gemini", "call-error", `model=${model} status=${res.status}`);
      }
      return null;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    logOp("gemini", "call", `model=${model} ok=${text !== null}`);
    return text;
  } catch (err) {
    // 外部I/O境界: 例外を握りつぶさずログに出す(本文・キーは載せない)。
    logOp("gemini", "call-exception", `model=${model}`, { error: err });
    return null;
  }
}
