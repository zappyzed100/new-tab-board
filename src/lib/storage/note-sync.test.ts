// note-sync.test.ts — ノート和集合マージと削除tombstoneの回帰テスト
import { describe, expect, it } from "vitest";
import type { Note } from "../../types";
import { markdownToNote, noteToMarkdown } from "../externalIO/nasArchive";
import { mergeNoteCollections, stampChangedNotes, updateTombstonesForMutation } from "./note-sync";

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
