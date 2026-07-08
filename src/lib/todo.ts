// todo.ts — 全ノート横断のTODO(チェックボックス)集約(純粋関数。SPEC.md §7 v1確定)
const TODO_LINE_PATTERN = /^\s*-\s*\[([ xX])\]\s*(.+)$/gm;

export type AggregatedTodo = {
  noteId: string;
  noteTitle: string;
  text: string;
  done: boolean;
};

export type TodoNote = { id: string; title: string; content: string };

export function extractTodos(note: TodoNote): AggregatedTodo[] {
  const todos: AggregatedTodo[] = [];
  for (const match of note.content.matchAll(TODO_LINE_PATTERN)) {
    todos.push({
      noteId: note.id,
      noteTitle: note.title,
      text: match[2].trim(),
      done: match[1].toLowerCase() === "x",
    });
  }
  return todos;
}

export function aggregateTodos(notes: TodoNote[]): AggregatedTodo[] {
  return notes.flatMap(extractTodos);
}
