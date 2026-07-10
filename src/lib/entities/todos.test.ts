// todos.test.ts — todos.ts の純粋関数の単体テスト
import { describe, expect, it } from "vitest";
import { addTodo, createTodo, removeTodo, sortedTodos, toggleTodo } from "./todos";

describe("createTodo / addTodo", () => {
  it("未完了の新しいTODOを作る", () => {
    const t = createTodo("牛乳を買う", 0);
    const after = addTodo([], t);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ text: "牛乳を買う", done: false });
  });
});

describe("toggleTodo", () => {
  it("指定したIDだけ完了/未完了を反転する", () => {
    const a = createTodo("A", 0);
    const b = createTodo("B", 1);
    const after = toggleTodo([a, b], a.id);
    expect(after.find((t) => t.id === a.id)?.done).toBe(true);
    expect(after.find((t) => t.id === b.id)?.done).toBe(false);
  });
});

describe("removeTodo", () => {
  it("指定したIDだけを削除する", () => {
    const a = createTodo("A", 0);
    const b = createTodo("B", 1);
    expect(removeTodo([a, b], a.id)).toEqual([b]);
  });
});

describe("sortedTodos", () => {
  it("未完了を先頭に、それぞれorder昇順で並べる", () => {
    const a = { ...createTodo("A", 1), done: true };
    const b = createTodo("B", 0);
    const c = createTodo("C", 2);
    expect(sortedTodos([a, b, c]).map((t) => t.text)).toEqual(["B", "C", "A"]);
  });
});
