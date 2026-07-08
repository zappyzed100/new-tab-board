// tags.ts — 本文から `#hoge` 形式のインラインタグを抽出する純粋関数(SPEC.md §4.2)
const TAG_PATTERN = /#([\p{L}\p{N}_]+)/gu;

export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  for (const match of content.matchAll(TAG_PATTERN)) {
    tags.add(match[1]);
  }
  return [...tags];
}
