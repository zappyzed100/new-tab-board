// bookmarks.test.ts — bookmarks.ts の純粋関数の単体テスト
import { describe, expect, it } from "vitest";
import {
  addBookmark,
  createBookmark,
  removeBookmark,
  reorderBookmarks,
  sortedBookmarks,
  updateBookmark,
} from "./bookmarks";

describe("createBookmark / addBookmark", () => {
  it("末尾に新しいブックマークを追加する", () => {
    const b = createBookmark("https://example.com", "Example", 0);
    const after = addBookmark([], b);
    expect(after).toHaveLength(1);
    expect(after[0].url).toBe("https://example.com");
    expect(after[0].icon).toEqual({ type: "favicon" });
  });
});

describe("updateBookmark", () => {
  it("指定したIDだけを更新し、他は変えない", () => {
    const a = createBookmark("https://a.example", "A", 0);
    const b = createBookmark("https://b.example", "B", 1);
    const after = updateBookmark([a, b], a.id, { label: "A2" });
    expect(after.find((x) => x.id === a.id)?.label).toBe("A2");
    expect(after.find((x) => x.id === b.id)?.label).toBe("B");
  });

  it("存在しないIDを指定しても元と同じ内容を返す", () => {
    const a = createBookmark("https://a.example", "A", 0);
    const after = updateBookmark([a], "no-such-id", { label: "X" });
    expect(after).toEqual([a]);
  });
});

describe("removeBookmark", () => {
  it("指定したIDだけを削除する", () => {
    const a = createBookmark("https://a.example", "A", 0);
    const b = createBookmark("https://b.example", "B", 1);
    const after = removeBookmark([a, b], a.id);
    expect(after).toEqual([b]);
  });
});

describe("sortedBookmarks / reorderBookmarks", () => {
  it("order昇順に並べる", () => {
    const a = createBookmark("https://a.example", "A", 2);
    const b = createBookmark("https://b.example", "B", 0);
    const c = createBookmark("https://c.example", "C", 1);
    expect(sortedBookmarks([a, b, c]).map((x) => x.label)).toEqual(["B", "C", "A"]);
  });

  it("先頭の要素を末尾へ移動しorderを振り直す", () => {
    const a = createBookmark("https://a.example", "A", 0);
    const b = createBookmark("https://b.example", "B", 1);
    const c = createBookmark("https://c.example", "C", 2);
    const after = reorderBookmarks([a, b, c], 0, 2);
    expect(after.map((x) => x.label)).toEqual(["B", "C", "A"]);
    expect(after.map((x) => x.order)).toEqual([0, 1, 2]);
  });

  it("末尾の要素を先頭へ移動できる", () => {
    const a = createBookmark("https://a.example", "A", 0);
    const b = createBookmark("https://b.example", "B", 1);
    const c = createBookmark("https://c.example", "C", 2);
    const after = reorderBookmarks([a, b, c], 2, 0);
    expect(after.map((x) => x.label)).toEqual(["C", "A", "B"]);
  });
});
