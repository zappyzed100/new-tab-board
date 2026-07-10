// todos.ts — 単体TODOリストの純粋な状態更新関数(I/Oを持たない。TodoMVC相当・ノート非依存)
import type { Todo } from "../../types";

export function createTodo(text: string, order: number): Todo {
  return { id: crypto.randomUUID(), text, done: false, order };
}

export function addTodo(todos: Todo[], todo: Todo): Todo[] {
  return [...todos, todo];
}

export function toggleTodo(todos: Todo[], id: string): Todo[] {
  return todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
}

export function removeTodo(todos: Todo[], id: string): Todo[] {
  return todos.filter((t) => t.id !== id);
}

/** 未完了を先頭に、それぞれorder昇順で並べたコピーを返す(TodoMVCの既定表示順に合わせる)。 */
export function sortedTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.order - b.order;
  });
}
