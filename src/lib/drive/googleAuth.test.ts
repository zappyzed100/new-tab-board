// googleAuth.test.ts — googleAuth.ts(chrome.identityラッパー)の単体テスト
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthToken, getAuthTokenWithError, invalidateToken } from "./googleAuth";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAuthToken", () => {
  it("トークン取得成功時はtokenを返す", async () => {
    vi.stubGlobal("chrome", {
      identity: { getAuthToken: vi.fn().mockResolvedValue({ token: "abc123" }) },
    });
    expect(await getAuthToken(true)).toBe("abc123");
  });

  it("resultにtokenが無ければnullを返す", async () => {
    vi.stubGlobal("chrome", {
      identity: { getAuthToken: vi.fn().mockResolvedValue({}) },
    });
    expect(await getAuthToken(false)).toBeNull();
  });

  it("例外が投げられても握りつぶしてnullを返す(未サインイン等)", async () => {
    vi.stubGlobal("chrome", {
      identity: { getAuthToken: vi.fn().mockRejectedValue(new Error("not signed in")) },
    });
    expect(await getAuthToken(false)).toBeNull();
  });
});

describe("getAuthTokenWithError", () => {
  it("トークン取得成功時はtokenを返しerrorはnull", async () => {
    vi.stubGlobal("chrome", {
      identity: { getAuthToken: vi.fn().mockResolvedValue({ token: "abc123" }) },
    });
    expect(await getAuthTokenWithError(true)).toEqual({ token: "abc123", error: null });
  });

  it("例外時は握りつぶさずerrorにメッセージを返す", async () => {
    vi.stubGlobal("chrome", {
      identity: { getAuthToken: vi.fn().mockRejectedValue(new Error("popup closed by user")) },
    });
    expect(await getAuthTokenWithError(true)).toEqual({
      token: null,
      error: "popup closed by user",
    });
  });

  it("resultにtokenが無ければtoken:nullとerrorメッセージを返す", async () => {
    vi.stubGlobal("chrome", {
      identity: { getAuthToken: vi.fn().mockResolvedValue({}) },
    });
    const result = await getAuthTokenWithError(false);
    expect(result.token).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe("invalidateToken", () => {
  it("removeCachedAuthTokenをtoken付きで呼ぶ", async () => {
    const removeCachedAuthToken = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { identity: { removeCachedAuthToken } });
    await invalidateToken("abc123");
    expect(removeCachedAuthToken).toHaveBeenCalledWith({ token: "abc123" });
  });
});
