// tags.test.ts — tags.ts(#タグ抽出)の単体テスト
import { describe, expect, it } from "vitest";
import { extractTags } from "./tags";

describe("extractTags", () => {
  it("本文中の#タグを重複無く抽出する", () => {
    expect(extractTags("今日は #買い物 と #掃除 をした。#買い物 は終わった。")).toEqual([
      "買い物",
      "掃除",
    ]);
  });

  it("英数字のタグも抽出できる", () => {
    expect(extractTags("#todo と #project_x")).toEqual(["todo", "project_x"]);
  });

  it("タグが無ければ空配列を返す", () => {
    expect(extractTags("タグの無い普通の文章")).toEqual([]);
  });

  it("URLのハッシュフラグメント等の# 単体は無視する(英数字が続かないため)", () => {
    expect(extractTags("見出し # だけ")).toEqual([]);
  });
});
