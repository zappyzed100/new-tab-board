// omnibar.test.ts — omnibar.ts(クイック検索バー解決)の単体テスト
import { describe, expect, it } from "vitest";
import { resolveOmnibarQuery } from "./omnibar";
import type { AppLaunch, Bookmark, Settings } from "../../types";

const settings: Settings = {
  openIn: "same",
  theme: "auto",
  searchEngine: "https://www.google.com/search?q=%s",
};

const bookmarks: Bookmark[] = [
  { id: "b1", url: "https://kinisoku.example", label: "キニ速", icon: { type: "emoji" }, order: 0 },
  {
    id: "b2",
    url: "https://alias.example",
    label: "エイリアス先",
    alias: "alx",
    icon: { type: "emoji" },
    order: 1,
  },
];

const appLaunches: AppLaunch[] = [{ id: "a1", alias: "code", scheme: "vscode://" }];

describe("resolveOmnibarQuery", () => {
  it("ブックマークのラベルに完全一致すればbookmarkを返す", () => {
    const result = resolveOmnibarQuery("キニ速", bookmarks, appLaunches, settings);
    expect(result).toEqual({ type: "bookmark", url: "https://kinisoku.example", openIn: "same" });
  });

  it("ブックマークのエイリアスに(大文字小文字を無視して)一致すればbookmarkを返す", () => {
    const result = resolveOmnibarQuery("ALX", bookmarks, appLaunches, settings);
    expect(result).toEqual({ type: "bookmark", url: "https://alias.example", openIn: "same" });
  });

  it("アプリのエイリアスに一致すればapplaunchを返す", () => {
    const result = resolveOmnibarQuery("code", bookmarks, appLaunches, settings);
    expect(result).toEqual({ type: "applaunch", url: "vscode://" });
  });

  it("どれにも一致しなければ検索エンジンURLへ解決する", () => {
    const result = resolveOmnibarQuery("hello world", bookmarks, appLaunches, settings);
    expect(result).toEqual({
      type: "search",
      url: "https://www.google.com/search?q=hello%20world",
    });
  });
});
