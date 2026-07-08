// board.ts — ボードの純粋なデータモデルと更新関数(I/Oを持たない)
export type Card = {
  id: string;
  text: string;
};

export type Column = {
  id: string;
  title: string;
  cards: Card[];
};

export type Board = {
  columns: Column[];
};

export function createEmptyBoard(): Board {
  return {
    columns: [
      { id: crypto.randomUUID(), title: "Todo", cards: [] },
      { id: crypto.randomUUID(), title: "Doing", cards: [] },
      { id: crypto.randomUUID(), title: "Done", cards: [] },
    ],
  };
}

export function addColumn(board: Board, title: string): Board {
  return {
    columns: [...board.columns, { id: crypto.randomUUID(), title, cards: [] }],
  };
}

export function removeColumn(board: Board, columnId: string): Board {
  return { columns: board.columns.filter((c) => c.id !== columnId) };
}

export function addCard(board: Board, columnId: string, text: string): Board {
  return {
    columns: board.columns.map((column) =>
      column.id === columnId
        ? { ...column, cards: [...column.cards, { id: crypto.randomUUID(), text }] }
        : column,
    ),
  };
}

export function removeCard(board: Board, columnId: string, cardId: string): Board {
  return {
    columns: board.columns.map((column) =>
      column.id === columnId
        ? { ...column, cards: column.cards.filter((c) => c.id !== cardId) }
        : column,
    ),
  };
}
