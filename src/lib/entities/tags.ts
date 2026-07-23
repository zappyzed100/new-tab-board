// tags.ts — 本文から `#hoge` 形式のインラインタグを抽出する純粋関数(SPEC.md §4.2)
//
// 手動タグの正本は「本文に書かれた `#タグ名`」(ユーザー指示・2026-07-23)。Note に手動タグ用の
// フィールドは持たない——Geminiの自動タグ(`note.tags`)は analyzeNote の結果で毎回**全置換**される
// ため、同じ配列へ混ぜると自動タグ付けのたびに手動分が消える。本文が正本なら消えようがない。
// 表示・検索・NAS/Driveのfront matter書き出しは、すべて resolveNoteTags で両者を合流させる。

// タグと見なす `#`: 行頭 or 空白 or 開き括弧の直後だけ(`http://x#frag` の断片や `###見出し` の
// 2つ目以降の`#`を拾わない)。`# 見出し` は CommonMark が `#` の後に空白を要求する書式なので
// そもそも一致しない——行頭の `#タグ` は見出しにならず、タグ解釈と Markdown 描画が食い違わない。
const TAG_PATTERN = /(?<=^|[\s(（「『【[])#([\p{L}\p{N}_]+)/gu;
// コードブロック(```〜```)とインラインコード(`〜`)。この中の `#` はコメント記号なので除外する
// (Python/シェルのコード片を貼ると `#!/usr/bin/env` 等が大量のゴミタグになるため)。
const FENCED_CODE_PATTERN = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|$)/gm;
const INLINE_CODE_PATTERN = /`[^`\n]*`/g;

/** タグ抽出の対象外にするコード領域を、位置をずらさないよう同じ長さの空白へ潰す。 */
function blankOutCode(content: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return content.replace(FENCED_CODE_PATTERN, blank).replace(INLINE_CODE_PATTERN, blank);
}

/** 本文中の `#タグ名` を手動タグとして抽出する(出現順・重複除去。コード領域は無視)。 */
export function extractTags(content: string): string[] {
  const tags = new Set<string>();
  for (const match of blankOutCode(content).matchAll(TAG_PATTERN)) {
    tags.add(match[1]);
  }
  return [...tags];
}

/** そのノートに付いているタグの正本: 本文の手動タグ(先) + Geminiの自動タグ(後)を重複除去して返す。
 * 表示・タグ検索・front matter書き出しはすべてこれを通す(片方だけを見ると手動タグが機能しない)。 */
export function resolveNoteTags(note: { content?: string; tags?: string[] }): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...extractTags(note.content ?? ""), ...(note.tags ?? [])]) {
    if (tag === "" || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Geminiのタグ付けへ渡す「タグ語彙」を作る(ユーザー指示: タグをある程度統一する)。
 * 並びの優先: ①ユーザーが並べたタグ候補(最優先) → ②既存ノートで頻出のタグ(頻度降順。
 * 既存タグを再利用させて表記ゆれ/乱立を抑える)。重複を除き最大 limit 個(既定200)に切る。
 * ②には本文の手動タグも含める(resolveNoteTags)——手で使っている語彙こそ統一の軸になるため。 */
export function buildTagVocabulary(
  tagCandidates: string[],
  notes: { content?: string; tags?: string[] }[],
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
  for (const n of notes) for (const t of resolveNoteTags(n)) freq.set(t, (freq.get(t) ?? 0) + 1);
  for (const [t] of [...freq.entries()].sort((a, b) => b[1] - a[1])) push(t);
  return out;
}
