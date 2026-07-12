// gemini.ts — Google Gemini API(generateContent)呼び出しの唯一の入出口
// タグ付け・要約・TODO抽出の各機能が共通で使う土台。APIキーはdb.tsの設定ストアに保存し
// (Drive/syncへ乗らない)、呼び出し側が読み出してこの関数へ渡す。無料枠のflashモデルを既定にする。
// ネットワークはfetchを依存注入で差し替え可能にし、テストは実APIを叩かずフェイクで検証する。
import { logOp } from "../runtime/log";

/** 既定モデル。gemini-2.0-flash等は実キーで無料枠が0(429)だったため、実疎通で無料枠が
 * 使えた gemini-flash-latest を採用(2026-07-12・実キーで検証)。「最新のflash」への別名で、
 * Googleがflashの安定版を差し替えても追従する。 */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiDeps = { fetch?: typeof fetch; model?: string };

/** プロンプトを投げてテキスト応答を返す。失敗(キー未設定・HTTPエラー・例外)はnull。
 * APIキーはURLのkeyクエリで渡す(Gemini APIの標準)。キー文字列自体はログに出さない(§7)。 */
export async function callGemini(
  prompt: string,
  apiKey: string,
  deps: GeminiDeps = {},
): Promise<string | null> {
  if (!apiKey) return null;
  const _fetch = deps.fetch ?? fetch;
  const model = deps.model ?? DEFAULT_GEMINI_MODEL;
  try {
    const res = await _fetch(
      `${API_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );
    if (!res.ok) {
      logOp("gemini", "call-error", `model=${model} status=${res.status}`);
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
