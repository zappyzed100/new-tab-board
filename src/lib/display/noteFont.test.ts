// noteFont.test.ts — clampNoteFontSize の単体テスト
import { describe, expect, it } from "vitest";
import { clampNoteFontSize, NOTE_FONT_DEFAULT, NOTE_FONT_MAX, NOTE_FONT_MIN } from "./noteFont";

describe("clampNoteFontSize", () => {
  it("範囲内はそのまま(整数へ丸める)", () => {
    expect(clampNoteFontSize(16)).toBe(16);
    expect(clampNoteFontSize(13.4)).toBe(13);
  });

  it("下限未満はMINへ、上限超はMAXへ丸める", () => {
    expect(clampNoteFontSize(NOTE_FONT_MIN - 5)).toBe(NOTE_FONT_MIN);
    expect(clampNoteFontSize(NOTE_FONT_MAX + 5)).toBe(NOTE_FONT_MAX);
  });

  it("NaN/Infinityは既定値へ倒す", () => {
    expect(clampNoteFontSize(Number.NaN)).toBe(NOTE_FONT_DEFAULT);
    expect(clampNoteFontSize(Number.POSITIVE_INFINITY)).toBe(NOTE_FONT_DEFAULT);
  });
});
