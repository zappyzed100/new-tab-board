// local-data-repository.test.ts — 排他コミットとノート差分保存の構造的不変条件を検証する
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalData, Note } from "../../types";
import { commitNoteMutation } from "./local-data-repository";
import { loadLocalData, patchLocalData } from "./storage";

function note(id: string, content: string, updatedAt: number): Note {
  return { id, title: id, content, pinned: false, order: 0, createdAt: 1, updatedAt };
}

function stubLocalStore(initial: LocalData) {
  const store: Record<string, unknown> = { localData: initial };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => {
          await Promise.resolve();
          Object.assign(store, items);
        },
      },
    },
  });
  return store;
}

describe("localData repository", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("同時に別フィールドを更新しても古い全体スナップショットで片方を消さない", async () => {
    stubLocalStore({ notes: [] });

    await Promise.all([
      patchLocalData({ alarmActive: true }),
      patchLocalData({ todos: [{ id: "t1", text: "todo", done: false, order: 0 }] }),
    ]);

    const saved = await loadLocalData();
    expect(saved.alarmActive).toBe(true);
    expect(saved.todos?.map((todo) => todo.id)).toEqual(["t1"]);
    expect(saved.storageRevision).toBe(2);
  });

  it("同じ初期状態を見た2タブのノート追加を差分として直列コミットし両方を残す", async () => {
    const base = [note("base", "base", 1)];
    stubLocalStore({ notes: base, noteTombstones: {} });

    await Promise.all([
      commitNoteMutation(base, [...base, note("from-tab-a", "A", 10)], 10),
      commitNoteMutation(base, [...base, note("from-tab-b", "B", 11)], 11),
    ]);

    const ids = (await loadLocalData()).notes.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["base", "from-tab-a", "from-tab-b"]));
  });

  it("一方のタブによる明示削除と他方の新規追加を同時に失わない", async () => {
    const base = [note("keep", "keep", 1), note("remove", "remove", 1)];
    stubLocalStore({ notes: base, noteTombstones: {} });

    await Promise.all([
      commitNoteMutation(base, [base[0]], 20),
      commitNoteMutation(base, [...base, note("added", "added", 21)], 21),
    ]);

    const saved = await loadLocalData();
    expect(saved.notes.some((item) => item.id === "remove")).toBe(false);
    expect(saved.notes.some((item) => item.id === "added")).toBe(true);
    expect(saved.noteTombstones?.remove).toBe(20);
  });

  it("同一ミリ秒の連続入力はローカルのコミット順で更新し競合コピーを作らない", async () => {
    const initial = [note("editing", "", 30)];
    stubLocalStore({ notes: initial, noteTombstones: {} });
    const first = [note("editing", "a", 30)];
    const second = [note("editing", "ab", 30)];

    await commitNoteMutation(initial, first, 30);
    await commitNoteMutation(first, second, 30);

    const saved = await loadLocalData();
    expect(saved.notes.find((item) => item.id === "editing")?.content).toBe("ab");
    expect(saved.notes.some((item) => item.id.includes("-conflict-"))).toBe(false);
  });
});
