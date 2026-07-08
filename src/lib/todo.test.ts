// todo.test.ts — todo.ts(横断TODO集約)の単体テスト
import { describe, expect, it } from "vitest";
import { aggregateTodos, extractTodos } from "./todo";

describe("extractTodos", () => {
  it("未完了/完了の両方を抽出する", () => {
    const note = { id: "n1", title: "買い物", content: "- [ ] 牛乳\n- [x] パン\n- [X] 卵" };
    expect(extractTodos(note)).toEqual([
      { noteId: "n1", noteTitle: "買い物", text: "牛乳", done: false },
      { noteId: "n1", noteTitle: "買い物", text: "パン", done: true },
      { noteId: "n1", noteTitle: "買い物", text: "卵", done: true },
    ]);
  });

  it("チェックボックス以外の行は無視する", () => {
    const note = { id: "n1", title: "メモ", content: "普通の文章\n- 箇条書き(チェック無し)" };
    expect(extractTodos(note)).toEqual([]);
  });
});

describe("aggregateTodos", () => {
  it("複数ノートのTODOを1つの配列にまとめる", () => {
    const notes = [
      { id: "n1", title: "A", content: "- [ ] タスク1" },
      { id: "n2", title: "B", content: "- [x] タスク2" },
    ];
    expect(aggregateTodos(notes)).toHaveLength(2);
  });
});
