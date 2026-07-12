// tagSearch.ts — タグによるノート絞り込みの純粋ロジック(メモリ内。ノートは最大501件・全件
// メモリ上なので索引不要で一瞬。SQLiteは外部用でアプリ内検索はこれで足りる——設計はplan.md)。
type TaggedNote = { tags?: string[]; junk?: boolean };

export type TagCount = { tag: string; count: number };

function countByTag(notes: TaggedNote[], predicate: (n: TaggedNote) => boolean): TagCount[] {
  const map = new Map<string, number>();
  for (const n of notes) {
    if (n.junk || !predicate(n)) continue;
    for (const tag of n.tags ?? []) map.set(tag, (map.get(tag) ?? 0) + 1);
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
    const tags = new Set(n.tags ?? []);
    return mode === "and" ? selected.every((t) => tags.has(t)) : selected.some((t) => tags.has(t));
  });
}

/** 選択タグ(AND一致)のノートに共起する“関連タグ”(選択済みは除く)。件数降順。 */
export function relatedTags(notes: TaggedNote[], selected: string[]): TagCount[] {
  if (selected.length === 0) return [];
  const sel = new Set(selected);
  const matching = filterNotesByTags(notes, selected, "and");
  return countByTag(matching, () => true).filter((tc) => !sel.has(tc.tag));
}
