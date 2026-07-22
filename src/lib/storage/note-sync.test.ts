// note-sync.test.ts — ノート和集合マージと削除tombstoneの回帰テスト
import { describe, expect, it } from "vitest";
import type { Note } from "../../types";
import { markdownToNote, noteToMarkdown } from "../externalIO/nasArchive";
import {
  mergeNoteCollections,
  preserveProtectedNote,
  preserveProtectedNotes,
  stampChangedNotes,
  updateTombstonesForMutation,
} from "./note-sync";

function note(id: string, content: string, updatedAt: number): Note {
  return { id, title: id, content, pinned: false, order: 0, createdAt: 1, updatedAt };
}

describe("mergeNoteCollections", () => {
  it("片側だけで作られたノートを削除せず和集合にする", () => {
    const merged = mergeNoteCollections([note("pc-a", "A", 10)], [note("pc-b", "B", 20)]);
    expect(merged.notes.map((n) => n.id).sort()).toEqual(["pc-a", "pc-b"]);
  });

  it("updatedAtの無い旧ノートもtombstoneが無ければ保持する", () => {
    const legacy = { ...note("legacy", "本文", 1), createdAt: undefined, updatedAt: undefined };
    expect(mergeNoteCollections([legacy], []).notes).toEqual([legacy]);
  });

  it("stale保存で別IDになった自動空ノートはタイトル単位で重複させない", () => {
    const local = { ...note("local-a", "", 10), title: "ノートA" };
    const remote = { ...note("remote-a", "", 20), title: "ノートA" };
    expect(mergeNoteCollections([local], [remote]).notes).toHaveLength(1);
  });

  it("別タブが生成した同名の自動空ノートは入力順に依存せず同じIDへ収束する", () => {
    const tabA = ["A", "B", "C"].map((letter, order) => ({
      ...note(`z-tab-${letter}`, "", 10),
      title: `ノート${letter}`,
      order,
    }));
    const tabB = ["A", "B", "C"].map((letter, order) => ({
      ...note(`a-tab-${letter}`, "", 10),
      title: `ノート${letter}`,
      order,
    }));

    const fromA = mergeNoteCollections(tabA, tabB).notes.map((item) => item.id);
    const fromB = mergeNoteCollections(tabB, tabA).notes.map((item) => item.id);
    expect(fromA).toEqual(["a-tab-A", "a-tab-B", "a-tab-C"]);
    expect(fromB).toEqual(fromA);
  });

  it("同じIDの自動空ノートにメタデータ差があっても競合コピーを作らない", () => {
    const local = { ...note("same", "", 10), title: "ノートA", order: 0 };
    const remote = { ...local, order: 2 };
    expect(mergeNoteCollections([local], [remote]).notes).toEqual([local]);
  });

  it("NAS/DriveのMarkdown往復で落ちるローカル専用メタデータを競合と誤判定しない", () => {
    const local: Note = {
      ...note("n1", "保存済み本文", 20),
      title: "保存済みノート",
      tags: [],
      done: false,
      special: false,
      taggedHash: "local-only-hash",
      driveFileId: "drive-file",
      lastSyncedAt: 30,
    };
    const restored = markdownToNote(noteToMarkdown(local));

    expect(mergeNoteCollections([local], [restored]).notes).toEqual([local]);
  });

  it("既に保存された偽の競合コピーだけを畳み、本文が違う本物の競合は残す", () => {
    const original = { ...note("n1", "同じ本文", 20), title: "元ノート", taggedHash: "local" };
    const redundant = {
      ...note("n1-conflict-abc", "同じ本文", 20),
      title: "元ノート (競合コピー)",
    };
    const realConflict = {
      ...note("n1-conflict-def", "別の本文", 20),
      title: "元ノート (競合コピー)",
    };

    expect(mergeNoteCollections([original, redundant, realConflict], []).notes).toEqual([
      original,
      realConflict,
    ]);
  });

  it("stale保存で別タイトルの自動空ノートが増えても3件へ畳む", () => {
    const placeholders = ["A", "B", "C", "D", "E", "F"].map((letter, order) => ({
      ...note(`n-${letter}`, "", 10),
      title: `ノート${letter}`,
      order,
    }));
    expect(
      mergeNoteCollections(placeholders.slice(0, 3), placeholders.slice(3)).notes,
    ).toHaveLength(3);
  });

  it("同じIDはupdatedAtが新しい内容を採る", () => {
    const merged = mergeNoteCollections([note("n1", "old", 10)], [note("n1", "new", 20)]);
    expect(merged.notes).toHaveLength(1);
    expect(merged.notes[0].content).toBe("new");
  });

  it("同時刻で同じIDを別編集した場合は競合コピーを残す", () => {
    const merged = mergeNoteCollections([note("n1", "A", 10)], [note("n1", "B", 10)]);
    expect(merged.notes).toHaveLength(2);
    expect(merged.notes.map((n) => n.content).sort()).toEqual(["A", "B"]);
    expect(merged.notes.some((n) => n.title.endsWith("(競合コピー)"))).toBe(true);
  });

  it("明示tombstoneがノートより新しい時だけ削除する", () => {
    expect(mergeNoteCollections([], [note("n1", "old", 10)], { n1: 20 }).notes).toEqual([]);
    expect(mergeNoteCollections([], [note("n1", "new", 30)], { n1: 20 }).notes[0].content).toBe(
      "new",
    );
  });
});

describe("preserveProtectedNote(編集中ノートを同期から守る)", () => {
  const placeholder = (id: string, title: string, order: number): Note => ({
    id,
    title,
    content: "",
    pinned: false,
    order,
  });

  it("protectedIdがnullなら何もしない", () => {
    const next = [note("a", "A", 10)];
    expect(preserveProtectedNote(next, next, null)).toBe(next);
  });

  it("protectedIdがlocalに無ければ何もしない(起動時の自動選択は保護対象外)", () => {
    const next = [note("a", "A", 10)];
    expect(preserveProtectedNote(next, next, "missing")).toBe(next);
  });

  it("同期結果から消えた編集中ノートを、local版で復活させる(削除を防ぐ)", () => {
    const local = [note("edit", "編集中", 10)];
    const next: Note[] = []; // 同期がdedup/マージで落とした
    const result = preserveProtectedNote(next, local, "edit");
    expect(result.map((n) => n.id)).toEqual(["edit"]);
  });

  it("編集中ノートの本文はlocal(編集中の最新)が勝つ(remoteの上書きを防ぐ)", () => {
    const local = [{ ...note("edit", "編集中の本文", 10), title: "T" }];
    const next = [{ ...note("edit", "リモートの古い本文", 10), title: "T" }];
    const result = preserveProtectedNote(next, local, "edit");
    expect(result.find((n) => n.id === "edit")?.content).toBe("編集中の本文");
  });

  it(
    "空placeholderを選んだ直後にdedupで別idの同名placeholderへ畳まれても、" +
      "選んだ方(protectedId)を残し同名の勝者を退ける(選択が飛ばない)",
    () => {
      const local = [placeholder("mine", "ノートA", 0)];
      const next = [placeholder("winner", "ノートA", 0)]; // dedupが別idを勝者にした
      const result = preserveProtectedNote(next, local, "mine");
      expect(result.map((n) => n.id)).toEqual(["mine"]);
    },
  );

  it("同orderのノートが割り込んでも、編集中ノートは表示位置を明け渡さない(タイに負けない)", () => {
    // 2026-07-22: 削除で疎になったorderのせいで補充空ノートが編集中ノートと同orderで生まれ、
    // 別コンテキストの確定通知を再適用した瞬間、旧実装(末尾へ追加してorderで再ソート)では
    // 安定ソートのタイに負けて編集中ノートが1つ右へ飛んだ(=一文字目が右のノートに飛んで見えた)。
    const local = [
      { ...note("a", "本文A", 10), order: 0 },
      { ...note("edit", "あ", 20), order: 4 },
      { ...note("f", "", 10), title: "ノートF", order: 5 },
    ];
    // 確定コミット(storage配列)では補充分(同order=4)が配列末尾に付いている。
    const next = [...local, placeholder("filled", "ノートB", 4)];
    const result = preserveProtectedNote(next, local, "edit");
    const ids = result.map((n) => n.id);
    expect(ids.indexOf("edit")).toBeLessThan(ids.indexOf("filled"));
    // 表示順(安定ソート)でも編集中ノートが元の位置(1)を保つ。
    expect(ids).toEqual(["a", "edit", "filled", "f"]);
  });

  it("編集中ノート以外の並び順・集合はそのまま(order昇順で返す)", () => {
    const local = [{ ...note("edit", "編集中", 10), order: 5 }];
    const next = [
      { ...note("x", "X", 10), order: 1 },
      { ...note("y", "Y", 10), order: 9 },
    ];
    const result = preserveProtectedNote(next, local, "edit");
    expect(result.map((n) => n.id)).toEqual(["x", "edit", "y"]); // order 1,5,9
  });
});

describe("preserveProtectedNotes(編集中ノート集合を同期から守る)", () => {
  it("空集合なら何もしない(参照を変えない)", () => {
    const next = [note("a", "A", 10)];
    expect(preserveProtectedNotes(next, next, new Set())).toBe(next);
  });

  it("複数の編集中ノートを同時に守る: 本文はlocalが勝ち、消えたものはlocalで復活する", () => {
    // ボードは全ノート同時編集可能。単一idの保護では、activeでない方のペインに入力していると
    // 守られず巻き戻る/消える実害があった。集合で受けて全部を不可侵にする。
    const local = [
      { ...note("p1", "編集中1", 20), order: 0 },
      { ...note("p2", "編集中2", 20), order: 1 },
      { ...note("other", "他", 10), order: 2 },
    ];
    // 外部の古い断面: p1は古い本文へ巻き戻り、p2はそもそも欠落、otherだけ素通し。
    const next = [
      { ...note("p1", "外部の古い本文", 10), order: 0 },
      { ...note("other", "他", 10), order: 2 },
    ];
    const result = preserveProtectedNotes(next, local, new Set(["p1", "p2"]));
    expect(result.find((n) => n.id === "p1")?.content).toBe("編集中1"); // 巻き戻らない
    expect(result.find((n) => n.id === "p2")?.content).toBe("編集中2"); // 消えない
    expect(result.map((n) => n.id)).toEqual(["p1", "p2", "other"]); // 並びはlocal順を保つ
  });

  it("集合に無い(編集していない)ノートは同期結果のまま更新される", () => {
    const local = [
      { ...note("edit", "編集中", 20), order: 0 },
      { ...note("bg", "ローカル旧", 10), order: 1 },
    ];
    const next = [
      { ...note("edit", "外部古い", 10), order: 0 },
      { ...note("bg", "外部の新しい本文", 30), order: 1 },
    ];
    const result = preserveProtectedNotes(next, local, new Set(["edit"]));
    expect(result.find((n) => n.id === "edit")?.content).toBe("編集中"); // 守る
    expect(result.find((n) => n.id === "bg")?.content).toBe("外部の新しい本文"); // 守らない=同期反映
  });

  it("明示削除(tombstone)された編集中ノートは復活させない(削除が全タブで収束する)", () => {
    // 別タブがフォーカス中ノートを削除→tombstone付きの確定通知が届く。編集保護よりも
    // 明示削除を優先しないと、削除したノートが編集中タブで生き返り削除が収束しない(実回帰)。
    const local = [note("edit", "編集中", 20)];
    const next: Note[] = []; // 削除で同期結果から消えた
    const result = preserveProtectedNotes(next, local, new Set(["edit"]), { edit: 30 });
    expect(result.map((n) => n.id)).toEqual([]); // 復活しない
  });

  it("tombstoneの無い単なる欠落(stale全体保存の取りこぼし)は従来どおり復活させる", () => {
    const local = [note("edit", "編集中", 20)];
    const next: Note[] = [];
    const result = preserveProtectedNotes(next, local, new Set(["edit"]), {}); // tombstone無し
    expect(result.map((n) => n.id)).toEqual(["edit"]); // 復活する
  });

  it("単一idラッパーは集合版へ委譲する(既存挙動を保つ)", () => {
    const local = [note("edit", "編集中の本文", 10)];
    const next = [note("edit", "リモートの古い本文", 10)];
    expect(preserveProtectedNote(next, local, "edit").find((n) => n.id === "edit")?.content).toBe(
      "編集中の本文",
    );
  });
});

describe("updateTombstonesForMutation", () => {
  it("配列から消したIDだけに削除記録を作る", () => {
    expect(
      updateTombstonesForMutation(
        [note("a", "A", 1), note("b", "B", 1)],
        [note("b", "B", 1)],
        {},
        50,
      ),
    ).toEqual({ a: 50 });
  });
});

describe("stampChangedNotes", () => {
  it("タイトル等の変更にも更新時刻を付けるがDrive同期メタデータだけなら付けない", () => {
    const before = note("n1", "本文", 10);
    expect(stampChangedNotes([before], [{ ...before, title: "変更" }], 20)[0].updatedAt).toBe(20);
    expect(
      stampChangedNotes([before], [{ ...before, driveFileId: "f1", lastSyncedAt: 20 }], 20)[0]
        .updatedAt,
    ).toBe(10);
  });
});
