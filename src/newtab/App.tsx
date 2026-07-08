// App.tsx — 新しいタブのルートコンポーネント(ボードUI)
import { useEffect, useState } from "react";
import type { Board } from "../lib/board";
import { addCard, addColumn, createEmptyBoard, removeCard, removeColumn } from "../lib/board";
import { now } from "../lib/clock";
import { loadBoard, saveBoard } from "../lib/storage";

export function App() {
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBoard().then((loaded) => {
      if (!cancelled) setBoard(loaded ?? createEmptyBoard());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (board) void saveBoard(board);
  }, [board]);

  if (!board) {
    return <div data-testid="board-loading">読み込み中…</div>;
  }

  return (
    <main data-testid="board">
      <h1>New Tab Board</h1>
      <div className="columns">
        {board.columns.map((column) => (
          <section key={column.id} data-testid={`column-${column.id}`}>
            <h2>{column.title}</h2>
            <ul>
              {column.cards.map((card) => (
                <li key={card.id} data-testid={`card-${card.id}`}>
                  {card.text}
                  <time
                    dateTime={new Date(card.createdAt).toISOString()}
                    data-testid={`card-created-at-${card.id}`}
                  >
                    {new Date(card.createdAt).toLocaleDateString()}
                  </time>
                  <button
                    type="button"
                    data-testid={`remove-card-${card.id}`}
                    onClick={() => setBoard(removeCard(board, column.id, card.id))}
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
            <AddCardForm
              columnId={column.id}
              onAdd={(text) => setBoard(addCard(board, column.id, text, now()))}
            />
            <button
              type="button"
              data-testid={`remove-column-${column.id}`}
              onClick={() => setBoard(removeColumn(board, column.id))}
            >
              カラムを削除
            </button>
          </section>
        ))}
      </div>
      <AddColumnForm onAdd={(title) => setBoard(addColumn(board, title))} />
    </main>
  );
}

function AddCardForm({ columnId, onAdd }: { columnId: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onAdd(text.trim());
        setText("");
      }}
    >
      <input
        aria-label="新しいカード"
        data-testid={`new-card-input-${columnId}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" data-testid={`add-card-button-${columnId}`}>
        カードを追加
      </button>
    </form>
  );
}

function AddColumnForm({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onAdd(title.trim());
        setTitle("");
      }}
    >
      <input
        aria-label="新しいカラム"
        data-testid="new-column-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit" data-testid="add-column-button">
        カラムを追加
      </button>
    </form>
  );
}
