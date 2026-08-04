// special.test.ts — special.ts(⭐スター/スペシャルの純粋ロジック)の単体テスト
import { describe, expect, it } from "vitest";
import {
  addSpecialFolder,
  freezeNoteToSpecial,
  normalizeFolder,
  removeSpecialItem,
  restoreSpecialItemToNote,
  setSpecialItemFolder,
  specialEntries,
  specialSyncSignature,
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
  it("「この端末のみ(noSync)」ノートを凍結するとnoSyncを引き継ぐ(special同期/バックアップから除外するため)", () => {
    const frozen = freezeNoteToSpecial(note({ id: "s", special: true, noSync: true }), 1);
    expect(frozen?.noSync).toBe(true);
  });
  it("noSyncでないノートの凍結項目はnoSyncを持たない(undefined)", () => {
    const frozen = freezeNoteToSpecial(note({ id: "s", special: true }), 1);
    expect(frozen?.noSync).toBeUndefined();
  });
});

describe("restoreSpecialItemToNote", () => {
  const frozen: SpecialItem = {
    id: "a",
    title: "計画",
    content: "大事なメモ",
    tags: ["旅行"],
    folder: "仕事",
    createdAt: 100,
    updatedAt: 200,
    frozenAt: 300,
  };

  it("凍結項目を同じidのノートへ戻す(内容/タイトル/タグ/フォルダ/createdAtを引き継ぐ)", () => {
    expect(restoreSpecialItemToNote(frozen, 7, 9000)).toEqual({
      id: "a",
      title: "計画",
      content: "大事なメモ",
      pinned: false,
      order: 7,
      special: true,
      specialFolder: "仕事",
      tags: ["旅行"],
      createdAt: 100,
      updatedAt: 9000,
    });
  });

  it(
    "updatedAtは回収時刻で上書きする(凍結時のupdatedAtのままだと、削除時のtombstoneより古く" +
      "なり repository の upsert が復活を捨てる — commitNoteMutation の tombstone 判定)",
    () => {
      const note = restoreSpecialItemToNote(frozen, 0, 9000);
      // 回収時刻 > 凍結(=削除)時刻。この不等号が崩れると復活が永続化されない。
      expect(note.updatedAt).toBe(9000);
      expect(note.updatedAt!).toBeGreaterThan(frozen.frozenAt);
    },
  );

  it("回収してもお気に入りからは外れない(special=trueのままliveとして一覧に残る)", () => {
    expect(restoreSpecialItemToNote(frozen, 0, 1).special).toBe(true);
  });

  it("「この端末のみ(noSync)」の凍結項目は回収後もnoSyncを保つ(戻した途端にNAS/Driveへ出さない)", () => {
    expect(restoreSpecialItemToNote({ ...frozen, noSync: true }, 0, 1).noSync).toBe(true);
    expect(restoreSpecialItemToNote(frozen, 0, 1).noSync).toBeUndefined();
  });

  it("フォルダ/タグ/createdAtを持たない凍結項目でもキーを生やさない(undefined混入で同期差分が出ない)", () => {
    const bare: SpecialItem = { id: "z", title: "z", content: "c", frozenAt: 1 };
    const note = restoreSpecialItemToNote(bare, 0, 2);
    expect(Object.keys(note).sort()).toEqual(
      ["content", "id", "order", "pinned", "special", "title", "updatedAt"].sort(),
    );
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

describe("specialSyncSignature", () => {
  it(
    "notes配列の並び順が変わってもエントリの中身が同じなら同じシグネチャを返す" +
      "(2026-07-16 是正: 並べ替えのたびに⭐全件がNAS/Driveへ無駄に再書き込みされていた回帰テスト)",
    () => {
      const a = note({ id: "a", title: "A", content: "本文A", special: true, specialFolder: "x" });
      const b = note({ id: "b", title: "B", content: "本文B", special: true, specialFolder: "x" });
      const sigBefore = specialSyncSignature(specialEntries([a, b], []));
      // ノート配列の物理的な並び順だけを入れ替える(reorderNotes相当の操作をシミュレート)。
      const sigAfterReorder = specialSyncSignature(specialEntries([b, a], []));
      expect(sigAfterReorder).toBe(sigBefore);
    },
  );

  it("エントリの内容が変わればシグネチャも変わる", () => {
    const a = note({ id: "a", title: "A", content: "本文A", special: true });
    const sigBefore = specialSyncSignature(specialEntries([a], []));
    const changed = note({ id: "a", title: "A", content: "本文A(編集)", special: true });
    const sigAfter = specialSyncSignature(specialEntries([changed], []));
    expect(sigAfter).not.toBe(sigBefore);
  });
});
