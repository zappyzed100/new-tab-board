// calendarMonth.test.ts — calendarMonth.ts(月グリッド・GCal URL)の単体テスト
import { describe, expect, it } from "vitest";
import { buildGCalUrl, buildMonthGrid } from "./calendarMonth";

describe("buildMonthGrid", () => {
  it("6週×7日=42マスを返す", () => {
    const grid = buildMonthGrid(2026, 0, new Date(2026, 0, 4));
    expect(grid).toHaveLength(6);
    grid.forEach((week) => expect(week).toHaveLength(7));
  });

  it("2026年1月1日は木曜(先頭週の5番目、0始まりindex4)がその日で当月扱い", () => {
    const grid = buildMonthGrid(2026, 0, new Date(2026, 0, 4));
    const jan1 = grid[0][4];
    expect(jan1.date).toBe(1);
    expect(jan1.isCurrentMonth).toBe(true);
  });

  it("今日の日付にisToday=trueが立つ", () => {
    const grid = buildMonthGrid(2026, 0, new Date(2026, 0, 4));
    const flat = grid.flat();
    const todays = flat.filter((d) => d.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0].date).toBe(4);
  });

  it("前月末尾の日はisCurrentMonth=false", () => {
    const grid = buildMonthGrid(2026, 0, new Date(2026, 0, 4));
    expect(grid[0][0].isCurrentMonth).toBe(false);
  });
});

describe("buildGCalUrl", () => {
  it("終日イベントのdatesパラメータを翌日までで組み立てる", () => {
    const t = new Date(2026, 0, 4).getTime();
    const url = buildGCalUrl(t, "テスト");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("dates=20260104%2F20260105");
    expect(url).toContain("text=%E3%83%86%E3%82%B9%E3%83%88");
  });
});
