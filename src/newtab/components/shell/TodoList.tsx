// TodoList.tsx — 単体TODOリスト(TodoMVC相当のUI。ノート本文からは独立)
import { useState, type KeyboardEvent } from "react";
import {
  addTodo,
  createTodo,
  removeTodo,
  sortedTodos,
  toggleTodo,
} from "../../../lib/entities/todos";
import type { Todo } from "../../../types";

type Props = {
  todos: Todo[];
  onTodosChange: (todos: Todo[]) => void;
};

export function TodoList({ todos, onTodosChange }: Props) {
  const [text, setText] = useState("");
  const sorted = sortedTodos(todos);

  function handleAdd(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const trimmed = text.trim();
    if (!trimmed) return;
    onTodosChange(addTodo(todos, createTodo(trimmed, todos.length)));
    setText("");
  }

  return (
    <div data-testid="todo-list">
      <input
        type="text"
        data-testid="todo-new-input"
        placeholder="何をする?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleAdd}
      />
      <ul>
        {sorted.map((todo) => (
          <li
            key={todo.id}
            data-testid={`todo-item-${todo.id}`}
            className={todo.done ? "todo-done" : ""}
          >
            <input
              type="checkbox"
              data-testid={`todo-toggle-${todo.id}`}
              checked={todo.done}
              onChange={() => onTodosChange(toggleTodo(todos, todo.id))}
            />
            <span>{todo.text}</span>
            <button
              type="button"
              data-testid={`todo-remove-${todo.id}`}
              className="todo-remove"
              title="このTODOを削除する"
              onClick={() => onTodosChange(removeTodo(todos, todo.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
