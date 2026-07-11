// clock.test.ts — clock.ts(時刻シーム)の単体テスト
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { msUntilNextInterval, now } from "./clock";

describe("now", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("window.__TIME_FREEZE__ が設定されていればその値を返す", () => {
    window.__TIME_FREEZE__ = 1700000000000;
    expect(now()).toBe(1700000000000);
  });

  it("__TIME_FREEZE__ が無ければ数値を返す(実時刻のフォールバック)", () => {
    expect(typeof now()).toBe("number");
    expect(now()).toBeGreaterThan(0);
  });
});

describe("msUntilNextInterval", () => {
  it("境界ちょうどなら次の1周期分を返す(0を返して即時再発火し続けるのを防ぐ)", () => {
    expect(msUntilNextInterval(60000, 60000)).toBe(60000);
  });

  it("境界の少し手前なら残り時間だけを返す", () => {
    expect(msUntilNextInterval(59000, 60000)).toBe(1000);
  });

  it("実行が遅延して境界を過ぎていても、次の境界までの正しい残り時間を返す(ズレを蓄積させない)", () => {
    // 60000msごとの境界を1500ms過ぎた状態(スロットリング等で遅延した想定)。
    expect(msUntilNextInterval(61500, 60000)).toBe(58500);
  });
});
