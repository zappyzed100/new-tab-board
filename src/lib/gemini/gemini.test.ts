// gemini.test.ts — gemini.ts(Gemini API呼び出し)の単体テスト。実APIは叩かずfetchをフェイクにする。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callGemini, DEFAULT_GEMINI_MODEL, resetGeminiRateLimitForTests } from "./gemini";

function okResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  } as Response;
}

// 429クールダウンはモジュール状態なのでテスト間でリセットする(前のテストの429が次に漏れないように)。
beforeEach(() => resetGeminiRateLimitForTests());

describe("callGemini", () => {
  it("応答テキストを取り出して返す", async () => {
    const fetchFake = vi.fn().mockResolvedValue(okResponse("要約結果です"));
    expect(await callGemini("要約して", "AIza-test", { fetch: fetchFake })).toBe("要約結果です");
  });

  it("既定モデルのgenerateContentへ、promptをcontents.parts.textに入れてPOSTする", async () => {
    const fetchFake = vi.fn().mockResolvedValue(okResponse("ok"));
    await callGemini("これを要約", "AIza-test", { fetch: fetchFake });
    const [url, init] = fetchFake.mock.calls[0];
    expect(url).toContain(`/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(url).toContain("key=AIza-test");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ contents: [{ parts: [{ text: "これを要約" }] }] });
  });

  it("APIキーが空ならfetchせずnull", async () => {
    const fetchFake = vi.fn();
    expect(await callGemini("x", "", { fetch: fetchFake })).toBeNull();
    expect(fetchFake).not.toHaveBeenCalled();
  });

  it("HTTPエラー(ok=false)ならnull", async () => {
    const fetchFake = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    expect(await callGemini("x", "AIza-test", { fetch: fetchFake })).toBeNull();
  });

  it("fetchが例外を投げても握りつぶしてnull(呼び出し側の機能を巻き込まない)", async () => {
    const fetchFake = vi.fn().mockRejectedValue(new Error("network down"));
    expect(await callGemini("x", "AIza-test", { fetch: fetchFake })).toBeNull();
  });

  it("candidatesが空でもnull(クラッシュしない)", async () => {
    const fetchFake = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);
    expect(await callGemini("x", "AIza-test", { fetch: fetchFake })).toBeNull();
  });

  it("modelを差し替えられる", async () => {
    const fetchFake = vi.fn().mockResolvedValue(okResponse("ok"));
    await callGemini("x", "AIza-test", { fetch: fetchFake, model: "gemini-1.5-flash" });
    expect(fetchFake.mock.calls[0][0]).toContain("/models/gemini-1.5-flash:generateContent");
  });

  it("429を食らったら、次の呼び出しはfetchせずnull(クールダウン)", async () => {
    const fetch429 = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    // 1回目: 429 → null(fetchは呼ばれる)
    expect(await callGemini("x", "AIza-test", { fetch: fetch429 })).toBeNull();
    expect(fetch429).toHaveBeenCalledTimes(1);
    // 2回目: クールダウン中なのでfetchせずnull(429エラーを連発しない)
    const fetch2 = vi.fn().mockResolvedValue(okResponse("本来は成功"));
    expect(await callGemini("x", "AIza-test", { fetch: fetch2 })).toBeNull();
    expect(fetch2).not.toHaveBeenCalled();
  });
});
