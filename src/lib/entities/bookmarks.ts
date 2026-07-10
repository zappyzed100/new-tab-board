// bookmarks.ts — ブックマークの純粋な状態更新関数(I/Oを持たない。SPEC.md §4.1)
import type { Bookmark } from "../../types";

export function createBookmark(
  url: string,
  label: string,
  order: number,
  alias?: string,
): Bookmark {
  return {
    id: crypto.randomUUID(),
    url,
    label,
    alias,
    icon: { type: "favicon" },
    order,
  };
}

export function addBookmark(bookmarks: Bookmark[], bookmark: Bookmark): Bookmark[] {
  return [...bookmarks, bookmark];
}

export function updateBookmark(
  bookmarks: Bookmark[],
  id: string,
  patch: Partial<Omit<Bookmark, "id">>,
): Bookmark[] {
  return bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b));
}

export function removeBookmark(bookmarks: Bookmark[], id: string): Bookmark[] {
  return bookmarks.filter((b) => b.id !== id);
}

/** 表示順(order昇順)に並べたコピーを返す。 */
export function sortedBookmarks(bookmarks: Bookmark[]): Bookmark[] {
  return [...bookmarks].sort((a, b) => a.order - b.order);
}

/** fromIndex の要素を toIndex の位置へ移動し、order を0始まりで振り直す(表示順基準)。 */
export function reorderBookmarks(
  bookmarks: Bookmark[],
  fromIndex: number,
  toIndex: number,
): Bookmark[] {
  const sorted = sortedBookmarks(bookmarks);
  const [moved] = sorted.splice(fromIndex, 1);
  sorted.splice(toIndex, 0, moved);
  return sorted.map((b, i) => ({ ...b, order: i }));
}
