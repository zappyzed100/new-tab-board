// noteSearch.test.ts — 現在の本文を対象にした部分一致検索/置換の単体テスト
import { describe, expect, it } from "vitest";
import { replaceInNotes, searchNotesByText } from "./noteSearch";
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

describe("replaceInNotes", () => {
  it("対象idに含まれるノートだけ、全出現を置換する(対象外は変更しない)", () => {
    const a = note("A", "りんごとりんごジュース");
    const b = note("B", "りんご狩り");
    const after = replaceInNotes([a, b], "りんご", "みかん", new Set([a.id]), 1000);
    expect(after.find((n) => n.id === a.id)?.content).toBe("みかんとみかんジュース");
    expect(after.find((n) => n.id === b.id)?.content).toBe("りんご狩り"); // 対象外は不変
  });

  it("置換したノートのupdatedAtだけ更新する", () => {
    const a = note("A", "りんご");
    const after = replaceInNotes([a], "りんご", "みかん", new Set([a.id]), 12345);
    expect(after[0].updatedAt).toBe(12345);
  });

  it("大文字小文字を無視して置換する", () => {
    const a = note("A", "Hello World hello");
    const after = replaceInNotes([a], "hello", "Hi", new Set([a.id]), 1000);
    expect(after[0].content).toBe("Hi World Hi");
  });

  it("空クエリ・対象0件・ヒット無しは元配列をそのまま返す(冪等)", () => {
    const notes = [note("A", "りんご")];
    expect(replaceInNotes(notes, "  ", "みかん", new Set([notes[0].id]), 1000)).toBe(notes);
    expect(replaceInNotes(notes, "りんご", "みかん", new Set(), 1000)).toBe(notes);
    expect(replaceInNotes(notes, "ぶどう", "みかん", new Set([notes[0].id]), 1000)).toBe(notes);
  });

  it("正規表現の特殊文字を含むクエリでもリテラルとして扱う", () => {
    const a = note("A", "価格は100円(税込)です");
    const after = replaceInNotes([a], "100円(税込)", "110円(税込)", new Set([a.id]), 1000);
    expect(after[0].content).toBe("価格は110円(税込)です");
  });
});
