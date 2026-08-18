// tagSearch.ts — タグによるノート絞り込みの純粋ロジック(メモリ内。ノートは最大501件・全件
// メモリ上なので索引不要で一瞬。SQLiteは外部用でアプリ内検索はこれで足りる——設計はPLAN.md)。
import { resolveNoteTags } from "../entities/tags";

// content を受けるのは本文中の `#タグ`(手動タグ)も検索対象にするため——タグの正本は
// resolveNoteTags(手動 + OpenRouterの自動)であって note.tags だけではない。
type TaggedNote = { content?: string; tags?: string[]; junk?: boolean };

export type TagCount = { tag: string; count: number };

function countByTag(notes: TaggedNote[], predicate: (n: TaggedNote) => boolean): TagCount[] {
  const map = new Map<string, number>();
  for (const n of notes) {
    if (n.junk || !predicate(n)) continue;
    for (const tag of resolveNoteTags(n)) map.set(tag, (map.get(tag) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** 全タグの出現ノート数(junkは除外)。件数降順→名前昇順。 */
export function tagCounts(notes: TaggedNote[]): TagCount[] {
  return countByTag(notes, () => true);
}

/** 選択タグでノートを絞る。and=全て含む / or=いずれか含む。選択0件なら空配列。junkは常に除外。 */
export function filterNotesByTags<T extends TaggedNote>(
  notes: T[],
  selected: string[],
  mode: "and" | "or",
): T[] {
  if (selected.length === 0) return [];
  return notes.filter((n) => {
    if (n.junk) return false;
    const tags = new Set(resolveNoteTags(n));
    return mode === "and" ? selected.every((t) => tags.has(t)) : selected.some((t) => tags.has(t));
  });
}

/** 固定タグモードの盤面フィルタ: 固定タグを**全て**持つノートだけを残す(ユーザー指示)。
 *
 * `filterNotesByTags(_, _, "and")` と分けているのは2点で意味が違うため:
 * - `junk` を除外しない——盤面はゴミ判定ノートも従来どおり表示する(消すのはNAS保管だけ)。
 * - `alwaysVisibleIds` を素通しする。**これが無いと固定タグモードで何も書き始められない**:
 *   末尾の空プレースホルダはタグを持たない(=消える)し、書き始めたノートはフォーカスが
 *   外れるまでタグが付かない(=1文字目で自分が盤面から消える)。App が「空プレースホルダ+
 *   編集中+選択中」を渡す。
 * 固定タグが空(モードOFF)なら元の配列をそのまま返す。 */
export function filterNotesByFixedTags<T extends TaggedNote & { id: string }>(
  notes: T[],
  fixedTags: string[],
  alwaysVisibleIds: ReadonlySet<string>,
): T[] {
  if (fixedTags.length === 0) return notes;
  return notes.filter((n) => {
    if (alwaysVisibleIds.has(n.id)) return true;
    const tags = new Set(resolveNoteTags(n));
    return fixedTags.every((t) => tags.has(t));
  });
}

/** 選択タグ(AND一致)のノートに共起する“関連タグ”(選択済みは除く)。件数降順。 */
export function relatedTags(notes: TaggedNote[], selected: string[]): TagCount[] {
  if (selected.length === 0) return [];
  const sel = new Set(selected);
  const matching = filterNotesByTags(notes, selected, "and");
  return countByTag(matching, () => true).filter((tc) => !sel.has(tc.tag));
}
