// commandPalette.ts — コマンドパレット(Cmd+K)の候補生成とフィルタ(純関数。SPEC.md §4.5)
import type { AppLaunch, Bookmark, Note } from "../../types";

export type CommandItem =
  | { type: "note"; id: string; label: string }
  | { type: "bookmark"; id: string; label: string; url: string }
  | { type: "applaunch"; id: string; label: string; url: string }
  | { type: "action"; id: string; label: string };

/** ノート切替・ブックマーク遷移・アプリ起動・(ファイルを開く等の)固定アクションを1つの候補リストに統合する。 */
export function buildCommandItems(
  notes: Note[],
  bookmarks: Bookmark[],
  appLaunches: AppLaunch[],
  actions: { id: string; label: string }[] = [],
): CommandItem[] {
  return [
    ...notes.map((n): CommandItem => ({ type: "note", id: n.id, label: n.title })),
    ...bookmarks.map((b): CommandItem => ({
      type: "bookmark",
      id: b.id,
      label: b.label,
      url: b.url,
    })),
    ...appLaunches.map((a): CommandItem => ({
      type: "applaunch",
      id: a.id,
      label: a.alias,
      url: a.scheme,
    })),
    ...actions.map((a): CommandItem => ({ type: "action", id: a.id, label: a.label })),
  ];
}

/** クエリでラベルを部分一致(大文字小文字無視)フィルタする。空クエリは全件を返す。 */
export function filterCommandItems(items: CommandItem[], query: string): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.label.toLowerCase().includes(q));
}
