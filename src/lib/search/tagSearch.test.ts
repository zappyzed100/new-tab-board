// tagSearch.test.ts — タグ絞り込み純粋ロジックの単体テスト
import { describe, expect, it } from "vitest";
import { filterNotesByTags, relatedTags, tagCounts } from "./tagSearch";

const notes = [
  { id: "a", tags: ["開発", "検索"] },
  { id: "b", tags: ["開発", "AI"] },
  { id: "c", tags: ["開発", "検索", "AI"] },
  { id: "d", tags: ["雑記"] },
  { id: "e", tags: ["開発"], junk: true }, // junkは常に無視
  { id: "f" }, // タグ無し
];

describe("tagCounts", () => {
  it("junkを除いてタグ件数を数え、件数降順→名前昇順で返す", () => {
    expect(tagCounts(notes)).toEqual([
      { tag: "開発", count: 3 },
      { tag: "AI", count: 2 },
      { tag: "検索", count: 2 },
      { tag: "雑記", count: 1 },
    ]);
  });
});

describe("filterNotesByTags", () => {
  it("AND: 全タグを含むノートだけ", () => {
    expect(filterNotesByTags(notes, ["開発", "検索"], "and").map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("OR: いずれかのタグを含むノート", () => {
    expect(filterNotesByTags(notes, ["検索", "雑記"], "or").map((n) => n.id)).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("選択0件なら空", () => {
    expect(filterNotesByTags(notes, [], "and")).toEqual([]);
  });

  it("junkノートは一致しても除外", () => {
    expect(filterNotesByTags(notes, ["開発"], "and").map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});

describe("relatedTags", () => {
  it("選択タグのノートに共起するタグを、選択済みを除いて返す", () => {
    // 「開発」のノート(a,b,c)に共起: 検索(a,c)=2, AI(b,c)=2
    expect(relatedTags(notes, ["開発"])).toEqual([
      { tag: "AI", count: 2 },
      { tag: "検索", count: 2 },
    ]);
  });

  it("選択0件なら空", () => {
    expect(relatedTags(notes, [])).toEqual([]);
  });
});

describe("本文の#タグ(手動タグ)もタグ検索の対象になる", () => {
  // タグの正本は resolveNoteTags(本文の手動タグ + Geminiの自動タグ)であって note.tags だけではない。
  const manual = [
    { id: "m1", content: "微分の復習 #数学", tags: ["復習"] },
    { id: "m2", content: "英単語 #英語", tags: [] },
    { id: "m3", content: "行列式 #数学 #線形代数", tags: ["復習"] },
  ];

  it("tagCounts が本文の#タグを数える", () => {
    expect(tagCounts(manual)).toEqual([
      { tag: "数学", count: 2 },
      { tag: "復習", count: 2 },
      { tag: "英語", count: 1 },
      { tag: "線形代数", count: 1 },
    ]);
  });

  it("filterNotesByTags が本文の#タグで絞り込める", () => {
    expect(filterNotesByTags(manual, ["数学"], "and").map((n) => n.id)).toEqual(["m1", "m3"]);
  });

  it("手動タグとGeminiタグのANDが効く(両者は同じ1つの集合として扱う)", () => {
    expect(filterNotesByTags(manual, ["数学", "復習"], "and").map((n) => n.id)).toEqual([
      "m1",
      "m3",
    ]);
  });
});
