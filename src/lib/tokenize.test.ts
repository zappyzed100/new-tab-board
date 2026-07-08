// tokenize.test.ts — tokenize.ts の単体テスト
import { describe, expect, it } from "vitest";
import { tokenize } from "./tokenize";

describe("tokenize", () => {
  it("英単語を小文字化して重複無く抽出する", () => {
    expect(tokenize("Hello hello World")).toEqual(["hello", "world"]);
  });

  it("日本語も語として抽出する", () => {
    expect(tokenize("今日は買い物に行った")).toEqual(["今日は買い物に行った"]);
  });

  it("記号は無視される", () => {
    expect(tokenize("foo, bar! baz?")).toEqual(["foo", "bar", "baz"]);
  });

  it("空文字列は空配列を返す", () => {
    expect(tokenize("")).toEqual([]);
  });
});
