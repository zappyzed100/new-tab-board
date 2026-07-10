// notes.test.ts — notes.ts の純粋関数の単体テスト
import { describe, expect, it } from "vitest";
import {
  addNote,
  createNote,
  nextNoteLetterTitle,
  removeNote,
  reorderNotes,
  sortedNotes,
  updateNote,
} from "./notes";

describe("createNote / addNote", () => {
  it("空の内容で新しいノートを作る", () => {
    const n = createNote("メモ1", 0);
    const after = addNote([], n);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ title: "メモ1", content: "", pinned: false });
  });
});

describe("updateNote", () => {
  it("指定したIDだけを更新する", () => {
    const a = createNote("A", 0);
    const b = createNote("B", 1);
    const after = updateNote([a, b], a.id, { content: "本文" });
    expect(after.find((n) => n.id === a.id)?.content).toBe("本文");
    expect(after.find((n) => n.id === b.id)?.content).toBe("");
  });
});

describe("removeNote", () => {
  it("指定したIDだけを削除する", () => {
    const a = createNote("A", 0);
    const b = createNote("B", 1);
    expect(removeNote([a, b], a.id)).toEqual([b]);
  });
});

describe("sortedNotes", () => {
  it("ピン留めを先頭に、それぞれorder昇順で並べる", () => {
    const a = { ...createNote("A", 1), pinned: false };
    const b = { ...createNote("B", 0), pinned: true };
    const c = { ...createNote("C", 0), pinned: false };
    expect(sortedNotes([a, b, c]).map((n) => n.title)).toEqual(["B", "C", "A"]);
  });
});

describe("reorderNotes", () => {
  it("表示順を基準に移動しorderを振り直す", () => {
    const a = createNote("A", 0);
    const b = createNote("B", 1);
    const c = createNote("C", 2);
    const after = reorderNotes([a, b, c], 0, 2);
    expect(after.map((n) => n.title)).toEqual(["B", "C", "A"]);
    expect(after.map((n) => n.order)).toEqual([0, 1, 2]);
  });
});

describe("nextNoteLetterTitle", () => {
  it("空なら「ノートA」を返す", () => {
    expect(nextNoteLetterTitle([])).toBe("ノートA");
  });

  it("既存のタイトルを避けて次の文字を返す", () => {
    expect(nextNoteLetterTitle(["ノートA", "ノートB"])).toBe("ノートC");
  });

  it("途中が空いていれば(削除等で)そこを埋める", () => {
    expect(nextNoteLetterTitle(["ノートA", "ノートC"])).toBe("ノートB");
  });

  it("ノートA〜Zが全て使用中ならnull(拒否対象)", () => {
    const all26 = Array.from({ length: 26 }, (_, i) => `ノート${String.fromCharCode(65 + i)}`);
    expect(nextNoteLetterTitle(all26)).toBeNull();
  });

  it("ノートA〜Z以外のタイトルは無視して判定する", () => {
    expect(nextNoteLetterTitle(["会議メモ", "ノートA"])).toBe("ノートB");
  });
});
