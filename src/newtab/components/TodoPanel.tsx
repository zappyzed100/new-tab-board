// TodoPanel.tsx — 全ノート横断のTODO集約表示(SPEC.md §7 v1確定)
import { aggregateTodos } from "../../lib/todo";
import type { Note } from "../../types";

type Props = {
  notes: Note[];
  onSelectNote: (noteId: string) => void;
};

export function TodoPanel({ notes, onSelectNote }: Props) {
  const todos = aggregateTodos(notes).filter((t) => !t.done);

  return (
    <div data-testid="todo-panel">
      {todos.length === 0 ? (
        <p data-testid="todo-empty">未完了のTODOはありません</p>
      ) : (
        <ul>
          {todos.map((todo, i) => (
            <li key={`${todo.noteId}-${i}`} data-testid={`todo-item-${todo.noteId}-${i}`}>
              <button
                type="button"
                data-testid={`todo-open-${todo.noteId}-${i}`}
                onClick={() => onSelectNote(todo.noteId)}
              >
                {todo.text}({todo.noteTitle})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
