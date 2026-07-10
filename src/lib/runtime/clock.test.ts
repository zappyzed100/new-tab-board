// clock.test.ts — clock.ts(時刻シーム)の単体テスト
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { now } from "./clock";

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
