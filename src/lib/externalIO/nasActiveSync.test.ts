// nasActiveSync.test.ts — 世代同期の判定/push/pull の単体テスト
import { describe, expect, it, vi } from "vitest";
import { decideActiveSync, pullActiveFromNas, pushActiveToNas } from "./nasActiveSync";
import { noteToMarkdown } from "./nasArchive";
import type { Note } from "../../types";

const note = (over: Partial<Note>): Note =>
  ({ id: "n", title: "t", content: "本文", pinned: false, order: 0, ...over }) as Note;

describe("decideActiveSync", () => {
  it("NASの世代が大きければ常にpull(最終操作者優先)", () => {
    expect(decideActiveSync(2, 3, false)).toBe("pull");
    expect(decideActiveSync(2, 3, true)).toBe("pull"); // 所有者でもNASが新しければpull
  });
  it("所有者で世代一致ならpush", () => {
    expect(decideActiveSync(3, 3, true)).toBe("push");
  });
  it("受動(非所有者)で世代一致ならnoop", () => {
    expect(decideActiveSync(3, 3, false)).toBe("noop");
  });
  it("自分が先行(nasGen<localGen)はnoop", () => {
    expect(decideActiveSync(5, 4, true)).toBe("noop");
  });
});

describe("pullActiveFromNas", () => {
  it("active/の.mdをNote[]へ復元しorder昇順で返す", async () => {
    const a = noteToMarkdown(note({ id: "a", title: "A", content: "本文A", order: 2 }));
    const b = noteToMarkdown(note({ id: "b", title: "B", content: "本文B", order: 0 }));
    const readNasActive = vi.fn().mockResolvedValue([
      { filename: "a.md", content: a },
      { filename: "b.md", content: b },
    ]);
    const notes = await pullActiveFromNas({
      getNasFolderPath: async () => "Z:\\NAS",
      readNasActive,
    });
    expect(notes?.map((n) => n.id)).toEqual(["b", "a"]); // order 0,2 の昇順
    expect(notes?.map((n) => n.content)).toEqual(["本文B", "本文A"]);
    expect(readNasActive).toHaveBeenCalledWith("Z:\\NAS");
  });

  it("NAS未設定ならnull(hostに触れない)", async () => {
    const readNasActive = vi.fn();
    expect(
      await pullActiveFromNas({ getNasFolderPath: async () => undefined, readNasActive }),
    ).toBeNull();
    expect(readNasActive).not.toHaveBeenCalled();
  });

  it("read-active失敗(null)ならnull", async () => {
    expect(
      await pullActiveFromNas({
        getNasFolderPath: async () => "Z:\\NAS",
        readNasActive: async () => null,
      }),
    ).toBeNull();
  });
});

describe("pushActiveToNas", () => {
  it("非空・非junkだけ書き、reconcileで削除突合する。ハッシュを返す", async () => {
    const writeNoteToNasStructure = vi.fn().mockResolvedValue(true);
    const reconcileActiveNotesOnNas = vi.fn().mockResolvedValue(0);
    const notes = [
      note({ id: "a", content: "本文" }),
      note({ id: "b", content: "  " }), // 空→書かない
      note({ id: "c", content: "ゴミ", junk: true }), // junk→書かない
    ];
    const res = await pushActiveToNas(
      notes,
      1000,
      {},
      {
        writeNoteToNasStructure,
        reconcileActiveNotesOnNas,
      },
    );
    expect(res.written).toBe(1);
    expect(writeNoteToNasStructure).toHaveBeenCalledTimes(1);
    expect(writeNoteToNasStructure).toHaveBeenCalledWith(notes[0], 1000);
    expect(reconcileActiveNotesOnNas).toHaveBeenCalledWith(notes);
    expect(res.savedHashes).toHaveProperty("a"); // aのハッシュが記録される
    expect(res.savedHashes).not.toHaveProperty("b"); // 空・junkは記録しない
  });

  it("フィンガープリントが前回と同じノートは書かない(ハッシュで保存済み判定)", async () => {
    const writeNoteToNasStructure = vi.fn().mockResolvedValue(true);
    const reconcileActiveNotesOnNas = vi.fn().mockResolvedValue(0);
    const notes = [note({ id: "a", content: "本文" }), note({ id: "b", content: "別" })];
    // 1回目: 全部書く。
    const r1 = await pushActiveToNas(
      notes,
      1000,
      {},
      {
        writeNoteToNasStructure,
        reconcileActiveNotesOnNas,
      },
    );
    expect(r1.written).toBe(2);
    // 2回目: 内容不変なら書かない(r1のハッシュを渡す)。
    writeNoteToNasStructure.mockClear();
    const r2 = await pushActiveToNas(notes, 2000, r1.savedHashes, {
      writeNoteToNasStructure,
      reconcileActiveNotesOnNas,
    });
    expect(r2.written).toBe(0);
    expect(writeNoteToNasStructure).not.toHaveBeenCalled();
    // 3回目: aの本文を変えたらaだけ書く。
    const changed = [note({ id: "a", content: "本文(変更)" }), note({ id: "b", content: "別" })];
    const r3 = await pushActiveToNas(changed, 3000, r2.savedHashes, {
      writeNoteToNasStructure,
      reconcileActiveNotesOnNas,
    });
    expect(r3.written).toBe(1);
    expect(writeNoteToNasStructure).toHaveBeenCalledWith(changed[0], 3000);
  });
});
