// diff.test.ts — diff.ts(2版間の差分算出)の単体テスト
import { describe, expect, it } from "vitest";
import { computeDiff } from "./diff";

describe("computeDiff", () => {
  it("同じ内容ならすべてequal", () => {
    expect(computeDiff("abc", "abc")).toEqual([{ type: "equal", text: "abc" }]);
  });

  it("末尾への追加をinsertとして検出する", () => {
    const result = computeDiff("abc", "abcdef");
    expect(result).toEqual([
      { type: "equal", text: "abc" },
      { type: "insert", text: "def" },
    ]);
  });

  it("削除をdeleteとして検出する", () => {
    const result = computeDiff("abcdef", "abc");
    expect(result).toEqual([
      { type: "equal", text: "abc" },
      { type: "delete", text: "def" },
    ]);
  });

  it("空文字列同士でも壊れない", () => {
    expect(computeDiff("", "")).toEqual([]);
  });
});
