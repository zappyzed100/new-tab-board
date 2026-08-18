// openrouter.test.ts — openrouter.ts(OpenRouter API呼び出し)の単体テスト。実APIは叩かない。
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  callOpenRouter,
  DEFAULT_OPENROUTER_MODEL,
  resetOpenRouterRateLimitForTests,
} from "./openrouter";

function okResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  } as Response;
}

beforeEach(() => resetOpenRouterRateLimitForTests());

describe("callOpenRouter", () => {
  it("応答テキストを取り出して返す", async () => {
    const fetchFake = vi.fn().mockResolvedValue(okResponse("タグ結果です"));
    expect(await callOpenRouter("タグ付けして", "sk-or-test", { fetch: fetchFake })).toBe(
      "タグ結果です",
    );
  });

  it("無料モデルルーターへBearer認証付きでPOSTする", async () => {
    const fetchFake = vi.fn().mockResolvedValue(okResponse("ok"));
    await callOpenRouter("これにタグを付ける", "sk-or-test", { fetch: fetchFake });
    const [url, init] = fetchFake.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer sk-or-test",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({
      model: DEFAULT_OPENROUTER_MODEL,
      messages: [{ role: "user", content: "これにタグを付ける" }],
    });
  });

  it("APIキーが空ならfetchせずnull", async () => {
    const fetchFake = vi.fn();
    expect(await callOpenRouter("x", "", { fetch: fetchFake })).toBeNull();
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it("HTTPエラーならnull", async () => {
    const fetchFake = vi.fn().mockResolvedValue({ ok: false, status: 402 } as Response);
    expect(await callOpenRouter("x", "sk-or-test", { fetch: fetchFake })).toBeNull();
  });

  it("429後はクールダウン中のfetchを抑止する", async () => {
    const fetch429 = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    expect(await callOpenRouter("x", "sk-or-test", { fetch: fetch429 })).toBeNull();
    const fetchNext = vi.fn().mockResolvedValue(okResponse("本来は成功"));
    expect(await callOpenRouter("x", "sk-or-test", { fetch: fetchNext })).toBeNull();
    expect(fetchNext).not.toHaveBeenCalled();
  });

  it("fetchが例外を投げてもnull", async () => {
    const fetchFake = vi.fn().mockRejectedValue(new Error("network down"));
    expect(await callOpenRouter("x", "sk-or-test", { fetch: fetchFake })).toBeNull();
  });

  it("choicesが空でもnull", async () => {
    const fetchFake = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    expect(await callOpenRouter("x", "sk-or-test", { fetch: fetchFake })).toBeNull();
  });

  it("配列形式のcontentも連結して返す", async () => {
    const fetchFake = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "旅行" },
                { type: "text", text: "計画" },
              ],
            },
          },
        ],
      }),
    } as Response);
    expect(await callOpenRouter("x", "sk-or-test", { fetch: fetchFake })).toBe("旅行計画");
  });
});
