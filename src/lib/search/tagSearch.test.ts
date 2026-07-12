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
