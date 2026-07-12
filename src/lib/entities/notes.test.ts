// notes.test.ts — notes.ts の純粋関数の単体テスト
import { describe, expect, it } from "vitest";
import {
  addNote,
  addNoteAfter,
  applyAutoTagToNote,
  createNote,
  mergeDroppedContent,
  pasteResultsIntoNotes,
  ensureTrailingEmptyNotes,
  MAX_NOTES,
  moveNoteUp,
  nextNoteLetterTitle,
  removeNote,
  reorderNotes,
  reorderNotesById,
  sortedNotes,
  updateNote,
} from "./notes";
import type { Note } from "../../types";

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

describe("addNoteAfter", () => {
  it("指定ノートの直後(表示順)へ挿入しorderを振り直す", () => {
    const a = createNote("A", 0);
    const b = createNote("B", 1);
    const c = createNote("C", 2);
    const s = createNote("Aの要約", 99);
    const after = addNoteAfter([a, b, c], s, a.id);
    expect(sortedNotes(after).map((n) => n.title)).toEqual(["A", "Aの要約", "B", "C"]);
    expect(sortedNotes(after).map((n) => n.order)).toEqual([0, 1, 2, 3]);
  });

  it("末尾ノートの直後なら末尾へ入る", () => {
    const a = createNote("A", 0);
    const b = createNote("B", 1);
    const s = createNote("Bの要約", 99);
    expect(sortedNotes(addNoteAfter([a, b], s, b.id)).map((n) => n.title)).toEqual([
      "A",
      "B",
      "Bの要約",
    ]);
  });

  it("afterIdが無ければ末尾へ追加する", () => {
    const a = createNote("A", 0);
    const s = createNote("S", 1);
    expect(addNoteAfter([a], s, "gone")).toEqual([a, s]);
  });
});

describe("pasteResultsIntoNotes", () => {
  it("末尾の白紙ノートを上書きし、末尾空3つを維持する", () => {
    const full = { ...createNote("既存", 0), content: "本文" };
    const notes = [
      full,
      createNote("ノートA", 1),
      createNote("ノートB", 2),
      createNote("ノートC", 3),
    ];
    const after = pasteResultsIntoNotes(notes, [{ title: "結果1", content: "内容1" }], 1000);
    const sorted = sortedNotes(after);
    // 既存(本文)は残り、末尾の白紙1つが結果で上書きされ、末尾空は3つ維持。
    expect(sorted.map((n) => n.title)).toContain("結果1");
    expect(sorted.find((n) => n.title === "結果1")?.content).toBe("内容1");
    const trailingEmpty = sorted.filter((n) => n.content.trim() === "").length;
    expect(trailingEmpty).toBe(3);
  });

  it("白紙より結果が多ければ追加し、順序が保たれる", () => {
    const notes = [createNote("ノートA", 0)]; // 白紙1つだけ
    const after = pasteResultsIntoNotes(
      notes,
      [
        { title: "r1", content: "c1" },
        { title: "r2", content: "c2" },
      ],
      1000,
    );
    const sorted = sortedNotes(after);
    const nonEmpty = sorted.filter((n) => n.content.trim() !== "");
    expect(nonEmpty.map((n) => n.title)).toEqual(["r1", "r2"]);
    expect(nonEmpty.map((n) => n.content)).toEqual(["c1", "c2"]);
    // 末尾空3つ維持。
    expect(sorted.filter((n) => n.content.trim() === "").length).toBe(3);
  });

  it("結果が空なら元配列をそのまま返す", () => {
    const notes = [createNote("ノートA", 0)];
    expect(pasteResultsIntoNotes(notes, [], 1000)).toBe(notes);
  });
});

describe("mergeDroppedContent(ファイルドロップの本文取り込み)", () => {
  it("空ノートは丸ごと置換する", () => {
    expect(mergeDroppedContent("   \n ", "ファイル本文")).toBe("ファイル本文");
  });
  it("非空ノートは空行区切りで末尾へ追記する(既存を消さない)", () => {
    expect(mergeDroppedContent("既存メモ", "追加分")).toBe("既存メモ\n\n追加分");
  });
});

describe("applyAutoTagToNote(保存時: タグ確定後にNASへ書くノートを合成する)", () => {
  const base: Note = {
    id: "n1",
    title: "ノートA", // 既定タイトル
    content: "旧",
    tags: ["旧タグ"],
    pinned: false,
    order: 0,
  };

  it("analysisのtags/junkを反映し、既定タイトルなら生成タイトルも採用する", () => {
    const out = applyAutoTagToNote(
      base,
      "新しい本文",
      { tags: ["登山", "高尾山"], junk: false, title: "高尾山メモ" },
      5000,
    );
    expect(out.tags).toEqual(["登山", "高尾山"]);
    expect(out.junk).toBe(false);
    expect(out.title).toBe("高尾山メモ"); // 既定タイトルだったので上書き
    expect(out.content).toBe("新しい本文");
    expect(out.updatedAt).toBe(5000);
  });

  it("手動命名(既定でない)タイトルは生成タイトルで上書きしない", () => {
    const named: Note = { ...base, title: "自分の会議メモ" };
    const out = applyAutoTagToNote(
      named,
      "本文",
      { tags: ["会議"], junk: false, title: "生成タイトル" },
      1,
    );
    expect(out.title).toBe("自分の会議メモ");
    expect(out.tags).toEqual(["会議"]);
  });

  it("junk判定はそのまま乗せる(呼び出し側がNAS除外に使う)", () => {
    const out = applyAutoTagToNote(base, "らくがき", { tags: [], junk: true, title: "" }, 1);
    expect(out.junk).toBe(true);
  });

  it("analysisがnull(タグ付けスキップ)なら既存tags/title/junkのまま本文とupdatedAtだけ更新する", () => {
    const out = applyAutoTagToNote(base, "本文だけ更新", null, 9000);
    expect(out.tags).toEqual(["旧タグ"]); // 変えない
    expect(out.title).toBe("ノートA");
    expect(out.content).toBe("本文だけ更新");
    expect(out.updatedAt).toBe(9000);
  });

  it("生成タイトルが空文字なら既定タイトルでも上書きしない", () => {
    const out = applyAutoTagToNote(base, "本文", { tags: ["x"], junk: false, title: "" }, 1);
    expect(out.title).toBe("ノートA");
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

  it("ノートA〜Zが全て使用中ならAA以降を解禁する(26→501へ拡張)", () => {
    const all26 = Array.from({ length: 26 }, (_, i) => `ノート${String.fromCharCode(65 + i)}`);
    expect(nextNoteLetterTitle(all26)).toBe("ノートAA");
  });

  it("A〜Z＋AAが使用中ならABを返す(スプレッドシート列風の採番)", () => {
    const used = [
      ...Array.from({ length: 26 }, (_, i) => `ノート${String.fromCharCode(65 + i)}`),
      "ノートAA",
    ];
    expect(nextNoteLetterTitle(used)).toBe("ノートAB");
  });

  it("MAX_NOTES件すべて使用中ならnull(拒否対象)", () => {
    // 全501件(A〜Z, AA〜, …)を使用済みにする。501件目まで生成して埋める。
    const used: string[] = [];
    while (used.length < MAX_NOTES) {
      const t = nextNoteLetterTitle(used);
      if (t === null) break;
      used.push(t);
    }
    expect(used).toHaveLength(MAX_NOTES);
    expect(nextNoteLetterTitle(used)).toBeNull();
  });

  it("ノートA〜Z以外のタイトルは無視して判定する", () => {
    expect(nextNoteLetterTitle(["会議メモ", "ノートA"])).toBe("ノートB");
  });
});

describe("reorderNotesById", () => {
  it("fromId を toId の位置へ移動する(表示順基準)", () => {
    const a = createNote("A", 0);
    const b = createNote("B", 1);
    const c = createNote("C", 2);
    const after = reorderNotesById([a, b, c], a.id, c.id);
    expect(after.map((n) => n.title).sort()).toEqual(["A", "B", "C"]);
    expect(sortedNotes(after).map((n) => n.title)).toEqual(["B", "C", "A"]);
  });

  it("同じidや存在しないidなら元配列をそのまま返す", () => {
    const a = createNote("A", 0);
    const b = createNote("B", 1);
    const notes = [a, b];
    expect(reorderNotesById(notes, a.id, a.id)).toBe(notes);
    expect(reorderNotesById(notes, "gone", b.id)).toBe(notes);
  });
});

describe("moveNoteUp", () => {
  it("順序列で1つ前のノートと入れ替える", () => {
    const a = createNote("A", 0);
    const b = createNote("B", 1);
    const c = createNote("C", 2);
    // C(index2)を1つ上へ → B と入れ替わって A, C, B
    expect(sortedNotes(moveNoteUp([a, b, c], c.id)).map((n) => n.title)).toEqual(["A", "C", "B"]);
  });

  it("先頭ノートは動かさない(元配列をそのまま返す)", () => {
    const a = createNote("A", 0);
    const b = createNote("B", 1);
    const notes = [a, b];
    expect(moveNoteUp(notes, a.id)).toBe(notes);
    expect(moveNoteUp(notes, "gone")).toBe(notes);
  });
});

describe("ensureTrailingEmptyNotes", () => {
  it("末尾の空ノートが足りなければ命名して補充する", () => {
    const a = { ...createNote("会議メモ", 0), content: "本文" };
    const after = ensureTrailingEmptyNotes([a], 3);
    expect(after).toHaveLength(4);
    // 補充分はすべて空で、ノートA/B/Cと命名される(既存タイトルを避ける)
    const added = after.filter((n) => n.id !== a.id);
    expect(added.every((n) => n.content === "")).toBe(true);
    expect(added.map((n) => n.title).sort()).toEqual(["ノートA", "ノートB", "ノートC"]);
  });

  it("末尾に既に空が3つあれば何もしない(冪等・同一参照)", () => {
    const notes = [
      { ...createNote("X", 0), content: "本文" },
      createNote("ノートA", 1),
      createNote("ノートB", 2),
      createNote("ノートC", 3),
    ];
    expect(ensureTrailingEmptyNotes(notes, 3)).toBe(notes);
  });

  it("末尾の空が2つなら1つだけ補充する", () => {
    const notes = [
      { ...createNote("X", 0), content: "本文" },
      createNote("ノートA", 1),
      createNote("ノートB", 2),
    ];
    const after = ensureTrailingEmptyNotes(notes, 3);
    expect(after).toHaveLength(4);
    expect(after.filter((n) => n.content === "")).toHaveLength(3);
  });

  it("空欄の並びが末尾になければ(間にあるだけなら)末尾側に補充する", () => {
    // 空(A) → 本文(X) の順。末尾は本文なので trailingEmpty=0 で3件補充される。
    const notes = [createNote("ノートA", 0), { ...createNote("X", 1), content: "本文" }];
    const after = ensureTrailingEmptyNotes(notes, 3);
    expect(after).toHaveLength(5);
  });

  it("MAX_NOTES 上限では補充を打ち止める", () => {
    const used: string[] = [];
    while (used.length < MAX_NOTES) {
      const t = nextNoteLetterTitle(used);
      if (t === null) break;
      used.push(t);
    }
    // 全501件を「本文あり」で埋める(末尾に空が無い状態)。
    const full = used.map((title, i) => ({ ...createNote(title, i), content: "本文" }));
    expect(ensureTrailingEmptyNotes(full, 3)).toHaveLength(MAX_NOTES);
  });
});
