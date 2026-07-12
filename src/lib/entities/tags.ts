// tags.ts — 本文から `#hoge` 形式のインラインタグを抽出する純粋関数(SPEC.md §4.2)
const TAG_PATTERN = /#([\p{L}\p{N}_]+)/gu;

export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  for (const match of content.matchAll(TAG_PATTERN)) {
    tags.add(match[1]);
  }
  return [...tags];
}

/** Geminiのタグ付けへ渡す「タグ語彙」を作る(ユーザー指示: タグをある程度統一する)。
 * 並びの優先: ①ユーザーが並べたタグ候補(最優先) → ②既存ノートで頻出のタグ(頻度降順。
 * 既存タグを再利用させて表記ゆれ/乱立を抑える)。重複を除き最大 limit 個(既定200)に切る。 */
export function buildTagVocabulary(
  tagCandidates: string[],
  notes: { tags?: string[] }[],
  limit = 200,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const t = raw.trim();
    if (t === "" || seen.has(t) || out.length >= limit) return;
    seen.add(t);
    out.push(t);
  };
  for (const c of tagCandidates) push(c); // ①ユーザー候補が最優先
  // ②既存ノートのタグを頻度降順で(同数はNaN回避のため安定)
  const freq = new Map<string, number>();
  for (const n of notes) for (const t of n.tags ?? []) freq.set(t, (freq.get(t) ?? 0) + 1);
  for (const [t] of [...freq.entries()].sort((a, b) => b[1] - a[1])) push(t);
  return out;
}
