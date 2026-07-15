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

/** 自動タグ付けの起動条件のひとつ: 前回起動時からの変更量(文字数の絶対差)が閾値を超えたか
 * (ユーザー指示: 保存イベント全般に乗せると早すぎたため、タグ専用の閾値をスナップショットの
 * 変更閾値(200字)とは別に400字で持つ)。 */
export const AUTO_TAG_CHANGE_THRESHOLD_CHARS = 400;

export function exceedsAutoTagChangeThreshold(
  lastContent: string,
  currentContent: string,
): boolean {
  return Math.abs(currentContent.length - lastContent.length) >= AUTO_TAG_CHANGE_THRESHOLD_CHARS;
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

/** タグ候補(ユーザーが並べた語彙)があれば「優先的に選ぶ候補」としてプロンプトへ差し込む一節を作る。
 * 候補が無ければ空文字(従来どおり自由にタグ付け)。合致が無ければ新しいタグでもよい旨も伝える。 */
function candidatesClause(tagCandidates: string[]): string {
  const list = tagCandidates.map((t) => t.trim()).filter((t) => t !== "");
  if (list.length === 0) return "";
  return (
    `できるだけ次の候補から選んでください(合致するものが無ければ新しいタグでも構いません): ` +
    `${list.join(", ")}\n`
  );
}

/** ノート本文の内容を表すタグを付ける。空・失敗は空配列。tagCandidatesがあれば優先候補として渡す。 */
export async function tagNote(
  content: string,
  apiKey: string,
  deps: GeminiDeps = {},
  tagCandidates: string[] = [],
): Promise<string[]> {
  if (content.trim() === "") return [];
  const prompt =
    `次のノートの内容を表すタグを${MAX_TAGS}個以内で、日本語の短い単語でカンマ区切りで出力してください。` +
    "タグだけを出力し、説明・前置き・#記号は付けないでください。\n" +
    candidatesClause(tagCandidates) +
    "\n---\n" +
    content;
  const text = await callGemini(prompt, apiKey, deps);
  return text ? parseTags(text) : [];
}

export type NoteAnalysis = { tags: string[]; junk: boolean; title: string };

/** ノートのタイトルとして使える1行に整える(改行・記号・引用符を除去し短く切る)。空なら""。 */
export function parseTitle(text: string): string {
  const line = text.split("\n")[0] ?? "";
  const cleaned = line
    .replace(/^[#＃"'「『\s]+/, "")
    .replace(/["'」』\s]+$/, "")
    .trim();
  return cleaned.length > 40 ? cleaned.slice(0, 40) : cleaned;
}

/** Geminiの応答から `JUDGE:` 行を探し、JUNKと明示されていればゴミと判定する。
 * 判定行が無い・曖昧な場合はfalse(=NASに残す。データを誤って捨てないための安全側)。 */
export function parseJunkFlag(text: string): boolean {
  const judge = /JUDGE:\s*(.*)/i.exec(text)?.[1] ?? "";
  return /\bJUNK\b/i.test(judge);
}

/** タグ付けと同時に「ゴミ(無意味・落書き)」かどうかも判定する(保存時の自動タグ付け＋NAS除外用)。
 * 空・失敗は {tags:[], junk:false}(安全側)。 */
export async function analyzeNote(
  content: string,
  apiKey: string,
  deps: GeminiDeps = {},
  tagCandidates: string[] = [],
): Promise<NoteAnalysis> {
  if (content.trim() === "") return { tags: [], junk: false, title: "" };
  const prompt =
    "次のノートについて3つ出力してください。出力形式を厳守すること。\n" +
    `TAGS: 内容を表すタグを${MAX_TAGS}個以内、日本語の短い単語でカンマ区切り(#や説明は不要)\n` +
    candidatesClause(tagCandidates) +
    "TITLE: 内容を表す短いタイトル(日本語・20文字程度・記号や引用符なし)\n" +
    "JUDGE: メモとして意味のある内容なら OK、テストの落書き・無意味・ゴミなら JUNK\n\n" +
    "例:\nTAGS: 買い物, 牛乳\nTITLE: 買い物リスト\nJUDGE: OK\n\n---\n" +
    content;
  const text = await callGemini(prompt, apiKey, deps);
  if (!text) return { tags: [], junk: false, title: "" };
  // TAGS行があればそこから、無ければ全文からタグを拾う(フォーマット逸脱への保険)。
  const tagsLine = /TAGS:\s*(.*)/i.exec(text)?.[1];
  const titleLine = /TITLE:\s*(.*)/i.exec(text)?.[1] ?? "";
  return {
    tags: parseTags(tagsLine ?? text),
    junk: parseJunkFlag(text),
    title: parseTitle(titleLine),
  };
}
