// nextEventCountdown.test.ts — nextEventCountdown.ts(カウントダウン算出)の単体テスト
import { describe, expect, it } from "vitest";
import { computeCountdown, formatCountdown } from "./nextEventCountdown";

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

  it("開始前は残り分数を切り上げて日・時間・分に分解する", () => {
    const cache = { title: "会議", startsAt: 10 * 60_000 };
    // 9分30秒後 → 切り上げで10分
    expect(computeCountdown(cache, 30_000)).toEqual({
      kind: "upcoming",
      days: 0,
      hours: 0,
      minutes: 10,
      isTomorrow: false,
      title: "会議",
    });
  });

  it("残り1分未満でも最低1分に切り上げる", () => {
    const cache = { title: "会議", startsAt: 60_000 };
    expect(computeCountdown(cache, 59_500)).toEqual({
      kind: "upcoming",
      days: 0,
      hours: 0,
      minutes: 1,
      isTomorrow: false,
      title: "会議",
    });
  });

  it("1時間以上は時間・分に分解する", () => {
    const now = new Date(2026, 0, 4, 10, 0, 0).getTime();
    const startsAt = now + (2 * 60 + 15) * 60_000; // 2時間15分後
    expect(computeCountdown({ title: "会議", startsAt }, now)).toEqual({
      kind: "upcoming",
      days: 0,
      hours: 2,
      minutes: 15,
      isTomorrow: false,
      title: "会議",
    });
  });

  it("24時間以上は日・時間・分に分解する", () => {
    // 23時startなら+26時間5分は暦日で2日後(isTomorrowと分離してdays/hours/minutesの
    // 分解だけを検証するため、日付が変わる境界を避けたnowを選んでいる)。
    const now = new Date(2026, 0, 4, 23, 0, 0).getTime();
    const startsAt = now + (26 * 60 + 5) * 60_000; // 1日2時間5分後
    expect(computeCountdown({ title: "会議", startsAt }, now)).toEqual({
      kind: "upcoming",
      days: 1,
      hours: 2,
      minutes: 5,
      isTomorrow: false,
      title: "会議",
    });
  });

  it("暦日で翌日にあたる予定はisTomorrow=trueになる(24時間未満でも)", () => {
    // 23時→翌1時(2時間後だが暦日は翌日)
    const now = new Date(2026, 0, 4, 23, 0, 0).getTime();
    const startsAt = new Date(2026, 0, 5, 1, 0, 0).getTime();
    const state = computeCountdown({ title: "会議", startsAt }, now);
    expect(state).toMatchObject({ isTomorrow: true });
  });

  it("暦日で2日以上先の予定はisTomorrow=falseになる(24時間以上でも)", () => {
    // 1時→翌々日3時(26時間後だが暦日は翌々日)
    const now = new Date(2026, 0, 4, 1, 0, 0).getTime();
    const startsAt = new Date(2026, 0, 6, 3, 0, 0).getTime();
    const state = computeCountdown({ title: "会議", startsAt }, now);
    expect(state).toMatchObject({ isTomorrow: false });
  });
});

describe("formatCountdown", () => {
  it("分のみ", () => {
    expect(
      formatCountdown({
        kind: "upcoming",
        days: 0,
        hours: 0,
        minutes: 10,
        isTomorrow: false,
        title: "",
      }),
    ).toBe("10分");
  });

  it("時間+分", () => {
    expect(
      formatCountdown({
        kind: "upcoming",
        days: 0,
        hours: 2,
        minutes: 15,
        isTomorrow: false,
        title: "",
      }),
    ).toBe("2時間15分");
  });

  it("日+時間+分", () => {
    expect(
      formatCountdown({
        kind: "upcoming",
        days: 1,
        hours: 2,
        minutes: 5,
        isTomorrow: false,
        title: "",
      }),
    ).toBe("1日2時間5分");
  });

  it("翌日なら末尾に(明日)が付く", () => {
    expect(
      formatCountdown({
        kind: "upcoming",
        days: 0,
        hours: 2,
        minutes: 0,
        isTomorrow: true,
        title: "",
      }),
    ).toBe("2時間0分(明日)");
  });
});
