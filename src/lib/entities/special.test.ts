// special.test.ts — special.ts(⭐スター/スペシャルの純粋ロジック)の単体テスト
import { describe, expect, it } from "vitest";
import {
  addSpecialFolder,
  freezeNoteToSpecial,
  normalizeFolder,
  removeSpecialItem,
  setSpecialItemFolder,
  specialEntries,
  toggleNoteSpecial,
  upsertSpecialItem,
} from "./special";
import type { Note, SpecialItem } from "../../types";

const note = (over: Partial<Note>): Note =>
  ({ id: "n", title: "t", content: "本文", pinned: false, order: 0, ...over }) as Note;

describe("toggleNoteSpecial", () => {
  it("指定ノートのspecialを反転する", () => {
    const [a] = toggleNoteSpecial([note({ id: "a" })], "a");
    expect(a.special).toBe(true);
    const [b] = toggleNoteSpecial([note({ id: "a", special: true })], "a");
    expect(b.special).toBe(false);
  });
});

describe("freezeNoteToSpecial", () => {
  it("スター済みノートを凍結SpecialItemへ(内容/フォルダ/frozenAtを持つ)", () => {
    const frozen = freezeNoteToSpecial(
      note({
        id: "a",
        title: "計画",
        content: "本文",
        tags: ["x"],
        special: true,
        specialFolder: "仕事",
      }),
      9000,
    );
    expect(frozen).toEqual({
      id: "a",
      title: "計画",
      content: "本文",
      tags: ["x"],
      folder: "仕事",
      createdAt: undefined,
      updatedAt: undefined,
      frozenAt: 9000,
    });
  });
  it("スターでないノートはnull(凍結しない)", () => {
    expect(freezeNoteToSpecial(note({ special: false }), 1)).toBeNull();
  });
});

describe("upsert/removeSpecialItem", () => {
  const item = (id: string, folder?: string): SpecialItem => ({
    id,
    title: id,
    content: "c",
    folder,
    frozenAt: 0,
  });
  it("同idは置換、新idは追加", () => {
    const items = [item("a"), item("b")];
    const up = upsertSpecialItem(items, { ...item("a"), title: "A2" });
    expect(up.find((i) => i.id === "a")?.title).toBe("A2");
    expect(up).toHaveLength(2);
    expect(upsertSpecialItem(items, item("c"))).toHaveLength(3);
  });
  it("removeは該当idを消す", () => {
    expect(removeSpecialItem([item("a"), item("b")], "a").map((i) => i.id)).toEqual(["b"]);
  });
  it("setSpecialItemFolderはフォルダを更新(空はルート=undefined)", () => {
    expect(setSpecialItemFolder([item("a")], "a", "  仕事/2026/ ")[0].folder).toBe("仕事/2026");
    expect(setSpecialItemFolder([item("a", "仕事")], "a", "")[0].folder).toBeUndefined();
  });
});

describe("normalizeFolder / addSpecialFolder", () => {
  it("前後空白・前後スラッシュを除く", () => {
    expect(normalizeFolder("  /仕事/2026/  ")).toBe("仕事/2026");
  });
  it("重複・空は追加しない", () => {
    expect(addSpecialFolder(["仕事"], "仕事")).toEqual(["仕事"]);
    expect(addSpecialFolder(["仕事"], "  ")).toEqual(["仕事"]);
    expect(addSpecialFolder(["仕事"], "趣味")).toEqual(["仕事", "趣味"]);
  });
});

describe("specialEntries", () => {
  it("live(スター済みノート)とfrozen(凍結)を合わせ、ノートがあればliveを優先", () => {
    const notes = [
      note({ id: "a", title: "Aノート", content: "最新A", special: true, specialFolder: "仕事" }),
      note({ id: "b", title: "非スター", special: false }),
    ];
    const items: SpecialItem[] = [
      { id: "a", title: "旧A", content: "古いA", frozenAt: 0 }, // 生きてるので無視される
      { id: "z", title: "Z凍結", content: "z", folder: "趣味", frozenAt: 0 },
    ];
    const entries = specialEntries(notes, items);
    // a は live 優先(最新A)、z は frozen。b(非スター)は出ない。
    const a = entries.find((e) => e.id === "a");
    expect(a).toMatchObject({ content: "最新A", source: "live", folder: "仕事" });
    const z = entries.find((e) => e.id === "z");
    expect(z).toMatchObject({ content: "z", source: "frozen", folder: "趣味" });
    expect(entries.some((e) => e.id === "b")).toBe(false);
  });

  it("フォルダ→タイトル順に並ぶ", () => {
    const notes = [
      note({ id: "1", title: "び", special: true, specialFolder: "z" }),
      note({ id: "2", title: "あ", special: true, specialFolder: "a" }),
      note({ id: "3", title: "い", special: true, specialFolder: "a" }),
    ];
    expect(specialEntries(notes, []).map((e) => e.title)).toEqual(["あ", "い", "び"]);
  });
});
