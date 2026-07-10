// links.ts — [[ノート名]]リンクのパースとバックリンクインデックス構築(純粋関数。SPEC.md §7 v1確定)
const LINK_PATTERN = /\[\[([^[\]]+)\]\]/g;

export function extractLinkedTitles(content: string): string[] {
  const titles = new Set<string>();
  for (const match of content.matchAll(LINK_PATTERN)) {
    titles.add(match[1].trim());
  }
  return [...titles];
}

export type Backlink = { fromNoteId: string; fromNoteTitle: string };
export type LinkableNote = { id: string; title: string; content: string };

/** ノートタイトル → そのノートへ [[リンク]] しているノート一覧、のバックリンク索引を作る。 */
export function buildBacklinkIndex(notes: LinkableNote[]): Map<string, Backlink[]> {
  const index = new Map<string, Backlink[]>();
  for (const note of notes) {
    for (const title of extractLinkedTitles(note.content)) {
      const list = index.get(title) ?? [];
      list.push({ fromNoteId: note.id, fromNoteTitle: note.title });
      index.set(title, list);
    }
  }
  return index;
}
