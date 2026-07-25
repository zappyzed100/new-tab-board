// @vitest-environment jsdom
// tab-session.test.ts — 「このタブだけ」の一時設定シーム(sessionStorage)の単体テスト
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTabFixedTagPresetId, writeTabFixedTagPresetId } from "./tab-session";

describe("固定タグプリセットの選択(タブ毎)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("未設定のタブは空文字(=モードOFF・全件表示)", () => {
    expect(readTabFixedTagPresetId()).toBe("");
  });

  it("書いた値がそのまま読める", () => {
    writeTabFixedTagPresetId("preset-1");
    expect(readTabFixedTagPresetId()).toBe("preset-1");
  });

  it("空文字を書くと選択が消える(キーごと消して未設定へ戻す)", () => {
    writeTabFixedTagPresetId("preset-1");
    writeTabFixedTagPresetId("");
    expect(readTabFixedTagPresetId()).toBe("");
    expect(sessionStorage.getItem("fixedTagPresetId")).toBeNull();
  });

  it("読めない環境ではモードOFFへ倒す(絞り込まれたまま操作不能にならない)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(readTabFixedTagPresetId()).toBe("");
  });

  it("書けない環境でも例外を投げない(画面のstateだけ切り替わる)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeTabFixedTagPresetId("preset-1")).not.toThrow();
  });
});
