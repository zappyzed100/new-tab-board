// tags.test.ts — tags.ts(#タグ抽出 / タグ語彙構築)の単体テスト
import { describe, expect, it } from "vitest";
import { buildTagVocabulary, extractTags } from "./tags";

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

describe("buildTagVocabulary", () => {
  const notes = [
    { tags: ["登山", "旅行"] },
    { tags: ["登山", "料理"] },
    { tags: ["登山"] },
    { tags: ["旅行"] },
  ];

  it("候補が先頭、続いて既存タグを頻度降順で並べる", () => {
    // 頻度: 登山3, 旅行2, 料理1。候補は最優先。
    expect(buildTagVocabulary(["買い物", "登山"], notes)).toEqual([
      "買い物",
      "登山", // 候補にあるので既存側では重複除去
      "旅行",
      "料理",
    ]);
  });

  it("重複と空白を除く(候補と既存で被っても1回)", () => {
    expect(buildTagVocabulary(["  ", "旅行", "旅行"], notes)).toEqual(["旅行", "登山", "料理"]);
  });

  it("最大 limit 個で切る(ユーザー指示: 200まで。ここは境界を小さくして検証)", () => {
    const many = Array.from({ length: 10 }, (_, i) => `c${i}`);
    expect(buildTagVocabulary(many, notes, 3)).toEqual(["c0", "c1", "c2"]);
  });

  it("候補が上限を占める場合、既存タグは足さない", () => {
    expect(buildTagVocabulary(["a", "b"], notes, 2)).toEqual(["a", "b"]);
  });

  it("既定の上限は200", () => {
    const candidates = Array.from({ length: 250 }, (_, i) => `t${i}`);
    expect(buildTagVocabulary(candidates, []).length).toBe(200);
  });
});
