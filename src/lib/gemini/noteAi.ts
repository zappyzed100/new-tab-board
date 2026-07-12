// noteAi.ts — Geminiを使ったノート補助機能(要約・TODO抽出)。プロンプト組み立てと応答解析。
// 実際のAPI通信はgemini.tsのcallGeminiに委譲し(fetchは依存注入で差し替え可能)、
// この層はプロンプトと結果パースだけを持つ(テストはfakeで実APIを叩かない)。
import { callGemini, type GeminiDeps } from "./gemini";

/** ノート本文を日本語で簡潔に要約する。空・失敗はnull。 */
export async function summarizeNote(
  content: string,
  apiKey: string,
  deps: GeminiDeps = {},
): Promise<string | null> {
  if (content.trim() === "") return null;
  const prompt =
    "次のノートの要点を日本語で簡潔に要約してください。" +
    "要約の本文だけを出力し、前置きや「要約:」などのラベル・記号は付けないでください。\n\n---\n" +
    content;
  const text = await callGemini(prompt, apiKey, deps);
  return text && text.trim() !== "" ? text.trim() : null;
}

/** Geminiの箇条書き応答から、行頭の「- 」「* 」「1. 」等を外してTODO文字列の配列にする(純粋関数)。 */
export function parseTodoLines(text: string): string[] {
  // 行頭の箇条書きマーカー: -/*/・ または 1./2) 等の番号。中黒(・)はスペース無しが普通なので
  // マーカーの後の空白は任意にする。
  const marker = /^([-*・]|\d+[.)])\s*/;
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => marker.test(line))
    .map((line) => line.replace(marker, "").trim())
    .filter((line) => line.length > 0);
}

/** ノート本文からやるべきこと(TODO)を抽出して配列で返す。空・失敗は空配列。 */
export async function extractTodos(
  content: string,
  apiKey: string,
  deps: GeminiDeps = {},
): Promise<string[]> {
  if (content.trim() === "") return [];
  const prompt =
    "次のノートから「やるべきこと(TODO)」を抽出してください。" +
    "各TODOを1行ずつ、行頭に「- 」を付けて出力し、TODO以外の説明・前置きは書かないでください。" +
    "TODOが無ければ何も出力しないでください。\n\n---\n" +
    content;
  const text = await callGemini(prompt, apiKey, deps);
  return text ? parseTodoLines(text) : [];
}
