// openrouter.ts — OpenRouter chat completions API呼び出しの唯一の入出口
// 自動タグ付けが使う無料モデルルーターを共通化する。APIキーはdb.tsの設定ストアから呼び出し側が
// 読み出して渡す。ネットワークはfetchを依存注入でき、テストは実APIを叩かない。
import { now as clockNow } from "../runtime/clock";
import { logOp } from "../runtime/log";

/** 無料モデルを自動選択するOpenRouter公式ルーター。 */
export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const RATE_LIMIT_COOLDOWN_MS = 60_000;
let rateLimitedUntil = 0;

/** テスト用: レート制限クールダウンをリセットする。 */
export function resetOpenRouterRateLimitForTests(): void {
  rateLimitedUntil = 0;
}

export type OpenRouterDeps = { fetch?: typeof fetch; model?: string };

type ChatCompletionResponse = {
  choices?: {
    message?: {
      content?: string | { type?: string; text?: string }[];
    };
  }[];
};

function responseText(data: ChatCompletionResponse): string | null {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return text || null;
}

/** プロンプトを投げてテキスト応答を返す。失敗・キー未設定・クールダウン中はnull。
 * APIキーはAuthorizationヘッダーへ渡し、URLやログへは出さない(§7 秘匿)。 */
export async function callOpenRouter(
  prompt: string,
  apiKey: string,
  deps: OpenRouterDeps = {},
): Promise<string | null> {
  if (!apiKey) return null;
  if (clockNow() < rateLimitedUntil) {
    logOp("openrouter", "skip-rate-limited", "cooldown中のためスキップ");
    return null;
  }
  const _fetch = deps.fetch ?? fetch;
  const model = deps.model ?? DEFAULT_OPENROUTER_MODEL;
  try {
    const res = await _fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      if (res.status === 429) {
        rateLimitedUntil = clockNow() + RATE_LIMIT_COOLDOWN_MS;
        logOp(
          "openrouter",
          "rate-limited",
          `model=${model} 429; ${RATE_LIMIT_COOLDOWN_MS}msクールダウン`,
        );
      } else {
        logOp("openrouter", "call-error", `model=${model} status=${res.status}`);
      }
      return null;
    }
    const text = responseText((await res.json()) as ChatCompletionResponse);
    logOp("openrouter", "call", `model=${model} ok=${text !== null}`);
    return text;
  } catch (err) {
    // 外部I/O境界: 例外を握りつぶさずログに出す(本文・キーは載せない)。
    logOp("openrouter", "call-exception", `model=${model}`, { error: err });
    return null;
  }
}
