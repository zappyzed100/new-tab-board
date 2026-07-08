// log.test.ts — logOp(ログ単一出口)の単体テスト
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logOp } from "./log";

describe("logOp", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("形式 `[タグ] 操作名: 詳細` で出力する", () => {
    logOp("storage", "load", "chrome.storage.local");
    expect(spy).toHaveBeenCalledWith("[storage] load: chrome.storage.local");
  });

  it("elapsedMs指定時は末尾に (+Xms) を付ける", () => {
    logOp("storage", "save", "chrome.storage.local", { elapsedMs: 12 });
    expect(spy).toHaveBeenCalledWith("[storage] save: chrome.storage.local (+12ms)");
  });

  it("error指定時は操作名の前にERRORを付け、error=を末尾に含める", () => {
    logOp("storage", "load", "failed", { error: new Error("boom") });
    expect(spy).toHaveBeenCalledWith("[storage] ERROR load: failed error=Error: boom");
  });
});
