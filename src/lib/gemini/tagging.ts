// tagging.ts — Geminiによるノートの自動タグ付け。プロンプト・応答パース・再タグ付け要否判定。
// 実API通信はgemini.tsのcallGeminiへ委譲(fetchは依存注入)。この層は純粋ロジック中心でテスト可能。
import { callGemini, type GeminiDeps } from "./gemini";

/** 1ノートに付けるタグの最大数。 */
export const MAX_TAGS = 5;

/** 本文の簡易ハッシュ(djb2)。タグ付け以降に本文が変わったかの判定用——全文を保存せず
 * ハッシュだけ持って比較する(taggedHash)。衝突は実害が小さい(たまに再タグ付けする程度)。 */
export function contentHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(h, 33) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** タグ付け以降に本文が変わった(=再タグ付けが必要)かを判定する。空ノートは対象外。 */
export function needsRetag(note: { content: string; taggedHash?: string }): boolean {
  if (note.content.trim() === "") return false;
  return contentHash(note.content) !== note.taggedHash;
}

/** Geminiのカンマ/読点/改行区切り応答からタグ配列にする(#・記号を外し、最大MAX_TAGS件・重複除去)。 */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of text.split(/[,、\n]/)) {
    const tag = raw.replace(/^[#＃\s*・-]+/, "").trim();
    if (tag !== "" && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/** ノート本文の内容を表すタグを付ける。空・失敗は空配列。 */
export async function tagNote(
  content: string,
  apiKey: string,
  deps: GeminiDeps = {},
): Promise<string[]> {
  if (content.trim() === "") return [];
  const prompt =
    `次のノートの内容を表すタグを${MAX_TAGS}個以内で、日本語の短い単語でカンマ区切りで出力してください。` +
    "タグだけを出力し、説明・前置き・#記号は付けないでください。\n\n---\n" +
    content;
  const text = await callGemini(prompt, apiKey, deps);
  return text ? parseTags(text) : [];
}
