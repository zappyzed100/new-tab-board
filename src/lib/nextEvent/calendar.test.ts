// calendar.test.ts — calendar.ts(Calendar API読み取り)の単体テスト(フェイクfetchを注入)
import { describe, expect, it, vi } from "vitest";
import { fetchNextEvent } from "./calendar";

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

describe("fetchNextEvent", () => {
  it("終日でない直近の予定を返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse({
        items: [
          { summary: "終日イベント", start: { date: "2026-07-10" } },
          { summary: "会議", start: { dateTime: "2026-07-10T15:00:00+09:00" } },
        ],
      }),
    );
    const result = await fetchNextEvent("token-abc", fetchImpl);
    expect(result).toEqual({
      title: "会議",
      startsAt: new Date("2026-07-10T15:00:00+09:00").getTime(),
    });
  });

  it("予定が無ければnullを返す", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ items: [] }));
    expect(await fetchNextEvent("token-abc", fetchImpl)).toBeNull();
  });

  it("終日予定しか無ければnullを返す(終日は対象外)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        fakeResponse({ items: [{ summary: "終日イベント", start: { date: "2026-07-10" } }] }),
      );
    expect(await fetchNextEvent("token-abc", fetchImpl)).toBeNull();
  });

  it("summary未設定なら「(無題の予定)」を使う", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        fakeResponse({ items: [{ start: { dateTime: "2026-07-10T15:00:00+09:00" } }] }),
      );
    const result = await fetchNextEvent("token-abc", fetchImpl);
    expect(result?.title).toBe("(無題の予定)");
  });

  it("HTTPエラーは例外を投げる", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 401));
    await expect(fetchNextEvent("token-abc", fetchImpl)).rejects.toThrow("HTTP 401");
  });
});
