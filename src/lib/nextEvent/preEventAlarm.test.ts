// preEventAlarm.test.ts — preEventAlarm.ts(予定前アラームのスケジュール計算)の単体テスト
import { describe, expect, it } from "vitest";
import { resolveAlarmTime } from "./preEventAlarm";

describe("resolveAlarmTime", () => {
  it("開始10分以上先なら開始-10分を返す", () => {
    const startsAt = 30 * 60_000; // 30分後
    expect(resolveAlarmTime(startsAt, 0)).toBe(20 * 60_000);
  });

  it("残り10分未満なら即時(now)に繰り上げる", () => {
    const startsAt = 5 * 60_000; // 5分後
    expect(resolveAlarmTime(startsAt, 0)).toBe(0);
  });

  it("既に開始している予定はnull(アラーム不要)", () => {
    expect(resolveAlarmTime(1000, 2000)).toBeNull();
    expect(resolveAlarmTime(1000, 1000)).toBeNull();
  });
});
