// board.test.ts — board.ts の純粋関数の単体テスト
import { describe, expect, it } from "vitest";
import { addCard, addColumn, createEmptyBoard, removeCard, removeColumn } from "./board";

describe("createEmptyBoard", () => {
  it("Todo/Doing/Done の3カラムを空の状態で作る", () => {
    const board = createEmptyBoard();
    expect(board.columns.map((c) => c.title)).toEqual(["Todo", "Doing", "Done"]);
    expect(board.columns.every((c) => c.cards.length === 0)).toBe(true);
  });
});

describe("addColumn / removeColumn", () => {
  it("末尾に新しいカラムを追加する", () => {
    const board = addColumn(createEmptyBoard(), "Backlog");
    expect(board.columns.at(-1)?.title).toBe("Backlog");
  });

  it("指定した列だけを削除し、他の列は変えない", () => {
    const before = createEmptyBoard();
    const target = before.columns[0].id;
    const after = removeColumn(before, target);
    expect(after.columns.some((c) => c.id === target)).toBe(false);
    expect(after.columns).toHaveLength(before.columns.length - 1);
  });

  it("存在しないIDを削除しようとしても元のボードと同じ内容を返す", () => {
    const before = createEmptyBoard();
    const after = removeColumn(before, "no-such-id");
    expect(after.columns).toHaveLength(before.columns.length);
  });
});

describe("addCard / removeCard", () => {
  it("指定した列だけにカードを追加し、他の列は変えない", () => {
    const before = createEmptyBoard();
    const [first, second] = before.columns;
    const after = addCard(before, first.id, "牛乳を買う", 0);
    expect(after.columns.find((c) => c.id === first.id)?.cards).toHaveLength(1);
    expect(after.columns.find((c) => c.id === second.id)?.cards).toHaveLength(0);
  });

  it("カードを削除すると同じ列の他のカードは残る", () => {
    let board = createEmptyBoard();
    const columnId = board.columns[0].id;
    board = addCard(board, columnId, "1枚目", 0);
    board = addCard(board, columnId, "2枚目", 1);
    const [keep, remove] = board.columns[0].cards;
    const after = removeCard(board, columnId, remove.id);
    expect(after.columns[0].cards.map((c) => c.id)).toEqual([keep.id]);
  });
});
