// gzip.test.ts — gzip.ts(圧縮/展開)の単体テスト
import { describe, expect, it } from "vitest";
import { gzipCompress, gzipDecompress } from "./gzip";

describe("gzipCompress / gzipDecompress", () => {
  it("往復すると元のテキストに戻る", async () => {
    const original = "# 見出し\n\n本文です。#タグ も含む。".repeat(20);
    const compressed = await gzipCompress(original);
    const restored = await gzipDecompress(compressed);
    expect(restored).toBe(original);
  });

  it("空文字列でも往復できる", async () => {
    const compressed = await gzipCompress("");
    expect(await gzipDecompress(compressed)).toBe("");
  });

  it("圧縮後の文字列はbase64として妥当", async () => {
    const compressed = await gzipCompress("hello world");
    expect(() => atob(compressed)).not.toThrow();
  });
});
