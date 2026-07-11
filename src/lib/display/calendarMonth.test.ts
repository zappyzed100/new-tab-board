// calendarMonth.test.ts — calendarMonth.ts(GCal URL生成)の単体テスト
import { describe, expect, it } from "vitest";
import { buildGCalUrl } from "./calendarMonth";

describe("buildGCalUrl", () => {
  it("終日イベントのdatesパラメータを翌日までで組み立てる", () => {
    const t = new Date(2026, 0, 4).getTime();
    const url = buildGCalUrl(t, "テスト");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("dates=20260104%2F20260105");
    expect(url).toContain("text=%E3%83%86%E3%82%B9%E3%83%88");
  });
});
