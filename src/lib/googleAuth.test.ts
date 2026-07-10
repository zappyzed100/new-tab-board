// googleAuth.test.ts — googleAuth.ts(chrome.identityラッパー)の単体テスト
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAuthToken, invalidateToken } from "./googleAuth";

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

describe("invalidateToken", () => {
  it("removeCachedAuthTokenをtoken付きで呼ぶ", async () => {
    const removeCachedAuthToken = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { identity: { removeCachedAuthToken } });
    await invalidateToken("abc123");
    expect(removeCachedAuthToken).toHaveBeenCalledWith({ token: "abc123" });
  });
});
