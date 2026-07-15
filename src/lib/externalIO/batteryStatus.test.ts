// batteryStatus.test.ts — batteryStatus.ts(GAS Web App中継クライアント)の単体テスト
import { describe, expect, it, vi } from "vitest";
import { fetchBatteryStatus } from "./batteryStatus";

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("fetchBatteryStatus", () => {
  it("トークンをクエリパラメータで送り、levelとupdatedAtを返す", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ ok: true, level: 42, updatedAt: "2026-07-16T00:00:00Z" }));
    const result = await fetchBatteryStatus(
      "https://script.google.com/macros/s/xxx/exec",
      "tok",
      fetchImpl,
    );
    expect(result).toEqual({ level: 42, updatedAt: "2026-07-16T00:00:00Z" });
    expect(fetchImpl).toHaveBeenCalledWith("https://script.google.com/macros/s/xxx/exec?token=tok");
  });

  it("既にクエリを含むURLでも&で連結する", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ ok: true, level: 10, updatedAt: null }));
    await fetchBatteryStatus("https://example.com/exec?foo=bar", "tok", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("https://example.com/exec?foo=bar&token=tok");
  });

  it("ok:falseならnullを返す(トークン不一致等)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ ok: false, error: "invalid token" }));
    expect(await fetchBatteryStatus("https://example.com", "wrong", fetchImpl)).toBeNull();
  });

  it("levelが未報告(null)ならnullを返す", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(fakeResponse({ ok: true, level: null, updatedAt: null }));
    expect(await fetchBatteryStatus("https://example.com", "tok", fetchImpl)).toBeNull();
  });

  it("HTTPエラーはnullを返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 500));
    expect(await fetchBatteryStatus("https://example.com", "tok", fetchImpl)).toBeNull();
  });

  it("fetch自体が例外を投げてもnullを返す(ネットワーク不通)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    expect(await fetchBatteryStatus("https://example.com", "tok", fetchImpl)).toBeNull();
  });
});
