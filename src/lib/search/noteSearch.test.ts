// noteSearch.test.ts — 現在の本文を対象にした部分一致検索の単体テスト
import { describe, expect, it } from "vitest";
import { searchNotesByText } from "./noteSearch";
import { createNote } from "../entities/notes";

function note(title: string, content: string) {
  return { ...createNote(title, 0), content };
}

describe("searchNotesByText", () => {
  it("空クエリは0件", () => {
    expect(searchNotesByText([note("A", "本文")], "  ")).toEqual([]);
  });

  it("日本語の部分文字列でも本文にヒットする(転置索引と違い完全一致不要)", () => {
    const notes = [note("会議", "明日は高尾山へ登山に行く"), note("買い物", "牛乳を買う")];
    const hits = searchNotesByText(notes, "高尾山");
    expect(hits).toHaveLength(1);
    expect(hits[0].note.title).toBe("会議");
    expect(hits[0].snippet).toContain("高尾山");
  });

  it("大文字小文字を無視する", () => {
    const hits = searchNotesByText([note("memo", "Hello World")], "world");
    expect(hits).toHaveLength(1);
  });

  it("本文になくてもタイトルにマッチすればヒットし、スニペットはタイトル", () => {
    const hits = searchNotesByText([note("登山メモ", "きょうの天気")], "登山");
    expect(hits).toHaveLength(1);
    expect(hits[0].snippet).toBe("登山メモ");
  });

  it("長い本文は一致箇所の前後だけを…付きで抜き出す", () => {
    const long = "あ".repeat(100) + "目印" + "い".repeat(100);
    const hits = searchNotesByText([note("A", long)], "目印");
    expect(hits[0].snippet).toContain("目印");
    expect(hits[0].snippet.startsWith("…")).toBe(true);
    expect(hits[0].snippet.endsWith("…")).toBe(true);
    expect(hits[0].snippet.length).toBeLessThan(long.length);
  });

  it("与えられた順序を保ち、複数ヒットを返す", () => {
    const notes = [note("A", "りんご"), note("B", "みかん"), note("C", "りんごジュース")];
    const hits = searchNotesByText(notes, "りんご");
    expect(hits.map((h) => h.note.title)).toEqual(["A", "C"]);
  });
});
