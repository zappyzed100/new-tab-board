// noteSearch.ts — 現在のノート本文を対象にした部分一致の全文検索。
// 転置インデックス(search.ts)はスナップショット履歴向けで、CJKは連続文字列まるごとが
// 1トークン=完全一致でしか引けない(search/CLAUDE.md)。ユーザー指摘「全文検索が空」への対応:
// ノートは全件メモリ上(最大501件)なので、生の本文をその場で走査すれば日本語の部分文字列でも
// 確実に・常に最新の状態で引ける。
import type { Note } from "../../types";

export type NoteSearchHit = { note: Note; snippet: string };

const SNIPPET_BEFORE = 20;
const SNIPPET_AFTER = 60;

/** 一致箇所の前後を抜き出した短いプレビュー(前後が切れていれば…を付ける)。 */
function makeSnippet(content: string, matchIndex: number, queryLen: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_BEFORE);
  const end = Math.min(content.length, matchIndex + queryLen + SNIPPET_AFTER);
  const core = content.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${core}${end < content.length ? "…" : ""}`;
}

/** 全ノートの本文(とタイトル)を部分一致(大文字小文字を無視)で走査してヒットを返す。
 * 本文にマッチすればその周辺のスニペット、本文になくタイトルにマッチすればタイトルを載せる。
 * 与えられたnotesの順序を保つ(呼び出し側で表示順に並べて渡す)。 */
export function searchNotesByText(notes: Note[], query: string): NoteSearchHit[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const hits: NoteSearchHit[] = [];
  for (const note of notes) {
    const idx = note.content.toLowerCase().indexOf(q);
    if (idx !== -1) {
      hits.push({ note, snippet: makeSnippet(note.content, idx, q.length) });
    } else if (note.title.toLowerCase().includes(q)) {
      hits.push({ note, snippet: note.title });
    }
  }
  return hits;
}
