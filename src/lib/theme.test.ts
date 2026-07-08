// theme.test.ts — theme.ts(テーマ解決)の単体テスト
import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("lightはそのままlight", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("darkはそのままdark", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("autoでprefers-color-scheme darkならdark", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
  });

  it("autoでprefers-color-scheme darkでなければlight", () => {
    expect(resolveTheme("auto", false)).toBe("light");
  });
});
