// clockFormat.test.ts — clockFormat.ts(時計/日付フォーマット)の単体テスト
import { describe, expect, it } from "vitest";
import { formatClock } from "./clockFormat";

describe("formatClock", () => {
  it("時刻をHH:MMでゼロ埋めする(秒は表示しない)", () => {
    const t = new Date(2026, 0, 4, 9, 5, 3).getTime(); // 2026-01-04 09:05:03, 日曜
    expect(formatClock(t).time).toBe("09:05");
  });

  it("日付をYYYY-MM-DD(曜日)でゼロ埋めする", () => {
    const t = new Date(2026, 0, 4, 9, 5, 3).getTime();
    expect(formatClock(t).date).toBe("2026-01-04(日)");
  });
});
