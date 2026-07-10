// omnibar.ts — クイック検索バーの解決ロジック(ブックマーク/アプリ起動/検索エンジンの順で解決。SPEC.md §4.4)
import type { AppLaunch, Bookmark, Settings } from "../../types";

export type OmnibarResult =
  | { type: "bookmark"; url: string; openIn: Settings["openIn"] }
  | { type: "applaunch"; url: string }
  | { type: "search"; url: string };

function matchesLabelOrAlias(query: string, label: string, alias?: string): boolean {
  const q = query.toLowerCase();
  return label.toLowerCase() === q || (alias ?? "").toLowerCase() === q;
}

/** 入力文字列を「ブックマーク → 登録アプリ → 既定の検索エンジン」の順で解決する(純関数)。 */
export function resolveOmnibarQuery(
  query: string,
  bookmarks: Bookmark[],
  appLaunches: AppLaunch[],
  settings: Settings,
): OmnibarResult {
  const bookmark = bookmarks.find((b) => matchesLabelOrAlias(query, b.label, b.alias));
  if (bookmark) return { type: "bookmark", url: bookmark.url, openIn: settings.openIn };

  const app = appLaunches.find((a) => matchesLabelOrAlias(query, a.alias));
  if (app) return { type: "applaunch", url: app.scheme };

  return { type: "search", url: settings.searchEngine.replace("%s", encodeURIComponent(query)) };
}
