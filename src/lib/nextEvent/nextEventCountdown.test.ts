// nextEventCountdown.test.ts — nextEventCountdown.ts(カウントダウン算出)の単体テスト
import { describe, expect, it } from "vitest";
import { computeCountdown } from "./nextEventCountdown";

describe("computeCountdown", () => {
  it("キャッシュが無ければnone", () => {
    expect(computeCountdown(null, 1000)).toEqual({ kind: "none" });
    expect(computeCountdown(undefined, 1000)).toEqual({ kind: "none" });
  });

  it("開始時刻を過ぎていればin-progress", () => {
    const cache = { title: "会議", startsAt: 1000 };
    expect(computeCountdown(cache, 1000)).toEqual({ kind: "in-progress" });
    expect(computeCountdown(cache, 2000)).toEqual({ kind: "in-progress" });
  });

  it("開始前は残り分数を切り上げてupcomingを返す", () => {
    const cache = { title: "会議", startsAt: 10 * 60_000 };
    // 9分30秒後 → 切り上げで10分
    expect(computeCountdown(cache, 30_000)).toEqual({
      kind: "upcoming",
      minutes: 10,
      title: "会議",
    });
  });

  it("残り1分未満でも最低1分に切り上げる", () => {
    const cache = { title: "会議", startsAt: 60_000 };
    expect(computeCountdown(cache, 59_500)).toEqual({
      kind: "upcoming",
      minutes: 1,
      title: "会議",
    });
  });
});
