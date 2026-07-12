// tagCandidates.ts — タグ候補(ユーザーが手で並べる語彙)の純粋な追加/削除。I/Oは持たない。
// LLMのタグ推定時に「優先的に選ぶ候補」として参照される(ユーザー指示。gemini/tagging.ts)。

/** 候補を末尾に追加する(前後空白を除去。空・重複は無視して元配列をそのまま返す)。 */
export function addTagCandidate(list: string[], tag: string): string[] {
  const trimmed = tag.trim();
  if (trimmed === "" || list.includes(trimmed)) return list;
  return [...list, trimmed];
}

/** 指定した候補を取り除く。 */
export function removeTagCandidate(list: string[], tag: string): string[] {
  return list.filter((t) => t !== tag);
}
