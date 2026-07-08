// commandPalette.test.ts — commandPalette.ts(候補生成・フィルタ)の単体テスト
import { describe, expect, it } from "vitest";
import { buildCommandItems, filterCommandItems } from "./commandPalette";
import type { AppLaunch, Bookmark, Note } from "../types";

const notes: Note[] = [{ id: "n1", title: "会議メモ", content: "", pinned: false, order: 0 }];
const bookmarks: Bookmark[] = [
  { id: "b1", url: "https://example.com", label: "サンプル", icon: { type: "emoji" }, order: 0 },
];
const appLaunches: AppLaunch[] = [{ id: "a1", alias: "code", scheme: "vscode://" }];

describe("buildCommandItems", () => {
  it("ノート・ブックマーク・アプリ起動を1つのリストへ統合する", () => {
    const items = buildCommandItems(notes, bookmarks, appLaunches);
    expect(items).toEqual([
      { type: "note", id: "n1", label: "会議メモ" },
      { type: "bookmark", id: "b1", label: "サンプル", url: "https://example.com" },
      { type: "applaunch", id: "a1", label: "code", url: "vscode://" },
    ]);
  });

  it("固定アクション(ファイルを開く等)を末尾に追加できる", () => {
    const items = buildCommandItems(notes, bookmarks, appLaunches, [
      { id: "open-file", label: "ファイルを開く" },
    ]);
    expect(items.at(-1)).toEqual({ type: "action", id: "open-file", label: "ファイルを開く" });
  });
});

describe("filterCommandItems", () => {
  const items = buildCommandItems(notes, bookmarks, appLaunches);

  it("空クエリは全件を返す", () => {
    expect(filterCommandItems(items, "")).toHaveLength(3);
  });

  it("ラベルへの部分一致(大文字小文字無視)でフィルタする", () => {
    expect(filterCommandItems(items, "CODE")).toEqual([
      { type: "applaunch", id: "a1", label: "code", url: "vscode://" },
    ]);
  });

  it("一致なしは空配列を返す", () => {
    expect(filterCommandItems(items, "存在しない")).toEqual([]);
  });
});
