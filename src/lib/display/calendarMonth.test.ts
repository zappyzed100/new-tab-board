// calendarMonth.test.ts — calendarMonth.ts(GCal URL生成)の単体テスト
import { describe, expect, it } from "vitest";
import { buildGCalMonthUrl, buildGCalUrl } from "./calendarMonth";

describe("buildGCalUrl", () => {
  it("終日イベントのdatesパラメータを翌日までで組み立てる", () => {
    const t = new Date(2026, 0, 4).getTime();
    const url = buildGCalUrl(t, "テスト");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("dates=20260104%2F20260105");
    expect(url).toContain("text=%E3%83%86%E3%82%B9%E3%83%88");
  });
});

describe("buildGCalMonthUrl", () => {
  it("0始まりのmonthを1始まりに変換して月表示URLを組み立てる", () => {
    // month=6は7月(0始まり)
    expect(buildGCalMonthUrl(2026, 6)).toBe(
      "https://calendar.google.com/calendar/r/month/2026/7/1",
    );
  });

  it("1月(month=0)も正しく1へ変換される", () => {
    expect(buildGCalMonthUrl(2026, 0)).toBe(
      "https://calendar.google.com/calendar/r/month/2026/1/1",
    );
  });
});
