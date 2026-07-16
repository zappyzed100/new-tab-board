// nasArchive.test.ts — nasArchive.ts(SSD→NAS store-and-forward)の単体テスト
// NASブリッジ(native-host/nas_bridge.py)への呼び出しはフェイクに差し替える
// (probeNasPath/writeFileToNas/readFileFromNasを依存注入)。
// NAS上はプレーンテキストで保存する仕様なので、IndexedDB側のcontentは実gzipCompressで
// 用意し、フェイクNASに書かれた内容が生テキストであることを検証する。
import { describe, expect, it } from "vitest";
import {
  flushAllToNas,
  flushSnapshotToNas,
  getSnapshotBody,
  markdownToNote,
  noteToMarkdown,
  readArchivedSnapshot,
  reconcileActiveNotesOnNas,
  todosToMarkdown,
  writeNoteMarkdownToNas,
  writeNoteToNasStructure,
  writeTodosToNasActive,
} from "./nasArchive";
import type { Note, Todo } from "../../types";
import { gzipCompress, gzipDecompress } from "../history/gzip";
import { putSnapshot, getSnapshot } from "../storage/db";
import type { Snapshot } from "../../types";

const NAS_PATH = "Z:\\NAS\\backup";

// 2026-07-12T12:00:00Z(UTC正午)——どのタイムゾーンでもカレンダー日付が7/12でぶれない値。
const TS_2026_07_12 = Date.UTC(2026, 6, 12, 12, 0, 0);

function makeFakeNas(
  options: {
    probeOk?: boolean;
    writeShouldFail?: boolean;
    corruptOnWrite?: boolean;
    junkNoteIds?: string[];
  } = {},
) {
  const files = new Map<string, string>();
  return {
    files,
    probeNasPath: async () => options.probeOk ?? true,
    writeFileToNas: async (_path: string, filename: string, content: string) => {
      if (options.writeShouldFail) return false;
      files.set(filename, options.corruptOnWrite ? `${content}CORRUPT` : content);
      return true;
    },
    readFileFromNas: async (_path: string, filename: string) => files.get(filename) ?? null,
    // 既定は空(ゴミ無し)。テストでloadLocalData(chrome.storage)を叩かせないため必ず注入する。
    getJunkNoteIds: async () => new Set(options.junkNoteIds ?? []),
  };
}

/** contentに実gzip+base64を持つスナップショットを作る。 */
async function snapshotWithBody(
  overrides: Partial<Snapshot> & { plain: string },
): Promise<Snapshot> {
  const { plain, ...rest } = overrides;
  return {
    id: "s1",
    noteId: "n1",
    timestamp: TS_2026_07_12,
    content: await gzipCompress(plain),
    archived: false,
    ...rest,
  };
}

describe("パスが未設定の場合(未注入=実getNasFolderPathが未設定を返す)", () => {
  it("flushAllToNasは0/0を返す", async () => {
    expect(await flushAllToNas()).toEqual({ flushed: 0, failed: 0 });
  });

  it("readArchivedSnapshotはnullを返す", async () => {
    expect(await readArchivedSnapshot("never-set.txt")).toBeNull();
  });
});

describe("flushSnapshotToNas", () => {
  it("contentが無ければfalse(二重フラッシュ防御)", async () => {
    const nas = makeFakeNas();
    const snap = await snapshotWithBody({ plain: "x" });
    expect(await flushSnapshotToNas(NAS_PATH, { ...snap, content: undefined }, nas)).toBe(false);
  });

  it("NASへは圧縮ではなくプレーンテキストで書き、年/月/日フォルダに置く", async () => {
    const nas = makeFakeNas();
    const snap = await snapshotWithBody({ plain: "会議メモ本文", id: "s-plain" });
    expect(await flushSnapshotToNas(NAS_PATH, snap, nas)).toBe(true);
    const expectedPath = `2026/7/12/n1-${TS_2026_07_12}-s-plain.txt`;
    expect(nas.files.get(expectedPath)).toBe("会議メモ本文"); // gzip base64ではなく生テキスト
  });

  it("書き込み自体が失敗すればfalse", async () => {
    const nas = makeFakeNas({ writeShouldFail: true });
    const snap = await snapshotWithBody({ plain: "x" });
    expect(await flushSnapshotToNas(NAS_PATH, snap, nas)).toBe(false);
  });

  it("再読込内容が一致しなければfalse", async () => {
    const nas = makeFakeNas({ corruptOnWrite: true });
    const snap = await snapshotWithBody({ plain: "x" });
    expect(await flushSnapshotToNas(NAS_PATH, snap, nas)).toBe(false);
  });

  it("contentが壊れたgzipでもthrowせずfalseを返す", async () => {
    const nas = makeFakeNas();
    const broken: Snapshot = {
      id: "s-broken",
      noteId: "n1",
      timestamp: TS_2026_07_12,
      content: "not-a-valid-gzip-base64!!!",
      archived: false,
    };
    expect(await flushSnapshotToNas(NAS_PATH, broken, nas)).toBe(false);
  });
});

describe("flushAllToNas(パス・NASクライアントを依存注入)", () => {
  it("ゴミ(junk)判定されたノートのスナップショットはNASへ書かず、ローカルに残す", async () => {
    await putSnapshot(
      await snapshotWithBody({ id: "s-junk", noteId: "junk-note", plain: "ゴミ本文" }),
    );
    const nas = makeFakeNas({ junkNoteIds: ["junk-note"] });
    await flushAllToNas({ getNasFolderPath: async () => NAS_PATH, ...nas });
    const snap = await getSnapshot("s-junk");
    expect(snap?.archived).toBe(false); // アーカイブされていない
    expect(snap?.content).toBeDefined(); // 本体はローカルに残ったまま(NASへ移していない)
    expect(nas.files.size).toBe(0); // NASには何も書かれていない
  });

  it("到達確認(probe)に失敗すれば0/0(フラッシュしない)", async () => {
    await putSnapshot(await snapshotWithBody({ id: "s-perm", plain: "body" }));
    const nas = makeFakeNas({ probeOk: false });
    expect(await flushAllToNas({ getNasFolderPath: async () => NAS_PATH, ...nas })).toEqual({
      flushed: 0,
      failed: 0,
    });
  });

  it("未archivedのみフラッシュし、既archived済みはスキップする", async () => {
    // getAllSnapshotsは全ノート横断のため、他テストが残した未archivedスナップショットの
    // 影響を受けないよう、集計件数ではなく対象スナップショット自体の状態を検証する。
    await putSnapshot(await snapshotWithBody({ id: "s-pending", plain: "body-1" }));
    await putSnapshot({
      id: "s-already",
      noteId: "n1",
      timestamp: 2000,
      archived: true,
      archivePath: "n1-2000-s-already.txt",
    });
    const nas = makeFakeNas();
    const deps = { getNasFolderPath: async () => NAS_PATH, ...nas };
    const result = await flushAllToNas(deps);
    expect(result.failed).toBe(0);

    const flushed = await getSnapshot("s-pending");
    expect(flushed?.archived).toBe(true);
    expect(flushed?.content).toBeUndefined();
    expect(flushed?.archivePath).toBe(`2026/7/12/n1-${TS_2026_07_12}-s-pending.txt`);

    const already = await getSnapshot("s-already");
    expect(already?.archivePath).toBe("n1-2000-s-already.txt"); // 上書きされず据え置き
  });

  it("readArchivedSnapshotはNAS上の生テキストを、getSnapshotBodyは圧縮base64を返す", async () => {
    await putSnapshot(await snapshotWithBody({ id: "s-roundtrip", plain: "本文2" }));
    const nas = makeFakeNas();
    const deps = { getNasFolderPath: async () => NAS_PATH, ...nas };
    await flushAllToNas(deps);
    const flushed = await getSnapshot("s-roundtrip");
    expect(flushed).toBeDefined();

    // readArchivedSnapshotはNAS上の生テキストをそのまま返す
    expect(await readArchivedSnapshot(flushed!.archivePath!, deps)).toBe("本文2");
    // getSnapshotBodyは呼び出し側がgzipDecompressできる圧縮base64へ正規化して返す
    const body = await getSnapshotBody(flushed!, deps);
    expect(body).not.toBeNull();
    expect(await gzipDecompress(body!)).toBe("本文2");
  });

  it("readArchivedSnapshotは存在しないファイルパスならnull", async () => {
    const nas = makeFakeNas();
    expect(
      await readArchivedSnapshot("missing.txt", {
        getNasFolderPath: async () => NAS_PATH,
        ...nas,
      }),
    ).toBeNull();
  });
});

describe("noteToMarkdown / writeNoteMarkdownToNas", () => {
  const baseNote: Note = {
    id: "note-1",
    title: "タグ検索の設計",
    content: "本文です。\n2行目。",
    pinned: false,
    order: 0,
    tags: ["開発", "検索"],
    createdAt: Date.UTC(2026, 6, 12, 7, 0, 0),
    updatedAt: Date.UTC(2026, 6, 12, 7, 20, 0),
  };

  it("YAML front matter + 本文 の.md文字列にする", () => {
    const md = noteToMarkdown(baseNote);
    expect(md).toContain("---\nid: note-1\n");
    expect(md).toContain("title: タグ検索の設計");
    expect(md).toContain("tags:\n  - 開発\n  - 検索");
    expect(md).toContain("created_at: 2026-07-12T07:00:00.000Z");
    expect(md).toContain("updated_at: 2026-07-12T07:20:00.000Z");
    expect(md.endsWith("---\n\n本文です。\n2行目。")).toBe(true);
  });

  it("特殊文字を含むタイトル/タグは二重引用符で囲む", () => {
    const md = noteToMarkdown({ ...baseNote, title: "A: B #タグ", tags: ["a,b"] });
    expect(md).toContain('title: "A: B #タグ"');
    expect(md).toContain('  - "a,b"');
  });

  it("タグが無ければ tags: [] を出す", () => {
    const md = noteToMarkdown({ ...baseNote, tags: [] });
    expect(md).toContain("tags: []");
  });

  it("要約ノートは source_note_id / generated_by を出す", () => {
    const md = noteToMarkdown({ ...baseNote, sourceNoteId: "orig-1", generatedBy: "gemini" });
    expect(md).toContain("source_note_id: orig-1");
    expect(md).toContain("generated_by: gemini");
  });

  it("notes/<id>.md へ書き出す", async () => {
    const nas = makeFakeNas();
    const ok = await writeNoteMarkdownToNas(baseNote, {
      getNasFolderPath: async () => NAS_PATH,
      ...nas,
    });
    expect(ok).toBe(true);
    expect(nas.files.get("notes/note-1.md")).toBe(noteToMarkdown(baseNote));
  });

  it("NAS未設定なら書かずfalse", async () => {
    expect(await writeNoteMarkdownToNas(baseNote)).toBe(false);
  });
});

describe("markdownToNote(世代pull: mdをNoteへ戻す)", () => {
  it("noteToMarkdown → markdownToNote で主要フィールドが往復する", () => {
    const note: Note = {
      id: "n1",
      title: "会議: メモ #x", // ':' '#' を含む=引用符付きで書かれる
      content: "本文\n2行目\n---区切りっぽい行", // 本文中の --- でも壊れない
      pinned: true,
      order: 5,
      tags: ["a,b", "c"], // ',' を含む=引用符
      createdAt: Date.UTC(2026, 6, 12, 7, 0, 0),
      updatedAt: Date.UTC(2026, 6, 12, 7, 20, 0),
      done: true,
      special: true,
      specialFolder: "仕事/2026",
      sourceNoteId: "orig",
      generatedBy: "gemini",
    };
    expect(markdownToNote(noteToMarkdown(note))).toMatchObject({
      id: "n1",
      title: "会議: メモ #x",
      content: "本文\n2行目\n---区切りっぽい行",
      pinned: true,
      order: 5,
      tags: ["a,b", "c"],
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      done: true,
      special: true,
      specialFolder: "仕事/2026",
      sourceNoteId: "orig",
      generatedBy: "gemini",
    });
  });

  it("tags:[] のノートは tags 無し・pinned/done は既定falseで戻る", () => {
    const back = markdownToNote(
      noteToMarkdown({ id: "n2", title: "t", content: "x", pinned: false, order: 2, tags: [] }),
    );
    expect(back.tags).toBeUndefined();
    expect(back.pinned).toBe(false);
    expect(back.done).toBeUndefined();
    expect(back.order).toBe(2);
  });

  it("front matterが無ければ全体を本文として扱い、idとfallback orderを補う", () => {
    const back = markdownToNote("ただの本文", 3);
    expect(back.content).toBe("ただの本文");
    expect(back.order).toBe(3);
    expect(typeof back.id).toBe("string");
    expect(back.id.length).toBeGreaterThan(0);
  });
});

describe("getSnapshotBody", () => {
  it("contentがあればNASを読まずそのまま返す(既に圧縮base64)", async () => {
    const compressed = await gzipCompress("raw");
    const withContent: Snapshot = {
      id: "s1",
      noteId: "n1",
      timestamp: TS_2026_07_12,
      content: compressed,
      archived: false,
    };
    expect(await getSnapshotBody(withContent)).toBe(compressed);
  });

  it("旧形式(.snapshot)のarchivePathは圧縮base64そのままとして返す(後方互換)", async () => {
    const legacyCompressed = await gzipCompress("旧本文");
    const nas = makeFakeNas();
    nas.files.set("n1-1-s-legacy.snapshot", legacyCompressed); // 旧コードは圧縮base64を書いていた
    const snap: Snapshot = {
      id: "s-legacy",
      noteId: "n1",
      timestamp: 1,
      archived: true,
      archivePath: "n1-1-s-legacy.snapshot",
    };
    const deps = { getNasFolderPath: async () => NAS_PATH, ...nas };
    const body = await getSnapshotBody(snap, deps);
    expect(body).toBe(legacyCompressed);
    expect(await gzipDecompress(body!)).toBe("旧本文");
  });

  it("archivedでもarchivePathが無ければnull", async () => {
    const noPath: Snapshot = {
      id: "s1",
      noteId: "n1",
      timestamp: TS_2026_07_12,
      content: undefined,
      archived: true,
    };
    expect(await getSnapshotBody(noPath)).toBeNull();
  });
});

describe("writeNoteToNasStructure(統一構造)", () => {
  const note = (over: Partial<Note> = {}): Note => ({
    id: "n1",
    title: "会議",
    content: "本文",
    pinned: false,
    order: 0,
    createdAt: TS_2026_07_12,
    updatedAt: TS_2026_07_12,
    ...over,
  });

  it("非空ノートを active/<タイトル> (id8桁).txt と <YYYY/M/D>/<id>.md へ書く", async () => {
    const files = new Map<string, string>();
    const ok = await writeNoteToNasStructure(note(), TS_2026_07_12, {
      getNasFolderPath: async () => NAS_PATH,
      writeFileToNas: async (_p, f, c) => {
        files.set(f, c);
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(files.has("active/会議 (n1).txt")).toBe(true);
    expect(files.has("2026/7/12/n1.md")).toBe(true);
    expect(files.get("active/会議 (n1).txt")).toContain("title: 会議");
  });

  it("空ノートは書かない(false)", async () => {
    let wrote = false;
    const ok = await writeNoteToNasStructure(note({ content: "  \n" }), TS_2026_07_12, {
      getNasFolderPath: async () => NAS_PATH,
      writeFileToNas: async () => {
        wrote = true;
        return true;
      },
    });
    expect(ok).toBe(false);
    expect(wrote).toBe(false);
  });
});

describe("reconcileActiveNotesOnNas(active/突合削除)", () => {
  it("現在の非空ノートに無い/空/ゴミの active ファイルを削除する(ファイル名末尾のid8桁で突き合わせる)", async () => {
    const deleted: string[] = [];
    const notes: Note[] = [
      { id: "keep1234", title: "a", content: "本文", pinned: false, order: 0 },
      { id: "empty123", title: "b", content: "", pinned: false, order: 1 },
      { id: "junky123", title: "c", content: "x", pinned: false, order: 2, junk: true },
    ];
    const n = await reconcileActiveNotesOnNas(notes, {
      getNasFolderPath: async () => NAS_PATH,
      listNasTree: async () => [
        "a (keep1234).txt",
        "b (gone1234).txt",
        "b (empty123).txt",
        "c (junky123).txt",
      ],
      deleteFileFromNas: async (_p, f) => {
        deleted.push(f);
        return true;
      },
    });
    // keep1234(非空) は残す。gone(存在しない)/empty(空)/junky(ゴミ) は削除。
    expect(deleted.sort()).toEqual([
      "active/b (empty123).txt",
      "active/b (gone1234).txt",
      "active/c (junky123).txt",
    ]);
    expect(n).toBe(3);
  });

  it("旧形式(<id>.md・拡張子/括弧が違う)のファイルはid断片が取れず保持対象なし扱いで削除される(移行)", async () => {
    const deleted: string[] = [];
    const notes: Note[] = [
      { id: "keep1234", title: "a", content: "本文", pinned: false, order: 0 },
    ];
    const n = await reconcileActiveNotesOnNas(notes, {
      getNasFolderPath: async () => NAS_PATH,
      listNasTree: async () => ["keep1234.md"],
      deleteFileFromNas: async (_p, f) => {
        deleted.push(f);
        return true;
      },
    });
    expect(deleted).toEqual(["active/keep1234.md"]);
    expect(n).toBe(1);
  });

  it("NAS未設定なら0(削除しない)", async () => {
    expect(await reconcileActiveNotesOnNas([], { getNasFolderPath: async () => undefined })).toBe(
      0,
    );
  });

  it(
    "タイトル変更で同じid断片のファイルが複数残っていても、現在の正本(新タイトル)以外を削除する" +
      "(2026-07-16是正: ノートが3つに増殖し1つ削除すると全部消えた不具合の回帰テスト——" +
      "旧実装はノートの存在有無しか見ておらず、リネームで孤立した旧タイトルのファイルを" +
      "永久に消せなかった)",
    async () => {
      const deleted: string[] = [];
      const notes: Note[] = [
        { id: "abcd1234-xxxx", title: "新タイトル", content: "本文", pinned: false, order: 0 },
      ];
      const n = await reconcileActiveNotesOnNas(notes, {
        getNasFolderPath: async () => NAS_PATH,
        // 旧タイトル→旧タイトル2→新タイトルの順にリネームされ、旧2つが孤立して残っている想定。
        listNasTree: async () => [
          "旧タイトル (abcd1234).txt",
          "旧タイトル2 (abcd1234).txt",
          "新タイトル (abcd1234).txt",
        ],
        deleteFileFromNas: async (_p, f) => {
          deleted.push(f);
          return true;
        },
      });
      expect(deleted.sort()).toEqual([
        "active/旧タイトル (abcd1234).txt",
        "active/旧タイトル2 (abcd1234).txt",
      ]);
      expect(n).toBe(2);
    },
  );

  it(
    "現在の正本(新タイトル)のファイルがまだ存在しない場合は、同じid断片の他ファイルを削除しない" +
      "(書き込み未完了/失敗時に最後の1コピーを消してデータを失わないための安全策)",
    async () => {
      const deleted: string[] = [];
      const notes: Note[] = [
        { id: "abcd1234-xxxx", title: "新タイトル", content: "本文", pinned: false, order: 0 },
      ];
      const n = await reconcileActiveNotesOnNas(notes, {
        getNasFolderPath: async () => NAS_PATH,
        // 「新タイトル (abcd1234).txt」がまだ書かれていない(直前の書き込みが未実行/失敗)想定。
        listNasTree: async () => ["旧タイトル (abcd1234).txt"],
        deleteFileFromNas: async (_p, f) => {
          deleted.push(f);
          return true;
        },
      });
      expect(deleted).toEqual([]);
      expect(n).toBe(0);
    },
  );
});

describe("todosToMarkdown", () => {
  it("order昇順でチェックリスト形式にする", () => {
    const todos: Todo[] = [
      { id: "t2", text: "後", done: false, order: 1 },
      { id: "t1", text: "先", done: true, order: 0 },
    ];
    const md = todosToMarkdown(todos);
    const lines = md.split("\n").filter((l) => l.startsWith("- ["));
    expect(lines).toEqual(["- [x] 先", "- [ ] 後"]);
  });

  it("0件でもfront matterだけのMarkdownを返す", () => {
    expect(todosToMarkdown([])).toContain("kind: todos");
  });
});

describe("writeTodosToNasActive", () => {
  it("active/todos.txtへ書く", async () => {
    const files = new Map<string, string>();
    const todos: Todo[] = [{ id: "t1", text: "買い物", done: false, order: 0 }];
    const ok = await writeTodosToNasActive(todos, {
      getNasFolderPath: async () => NAS_PATH,
      writeFileToNas: async (_p, f, c) => {
        files.set(f, c);
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(files.get("active/todos.txt")).toContain("- [ ] 買い物");
  });

  it("NAS未設定ならfalse", async () => {
    expect(await writeTodosToNasActive([], { getNasFolderPath: async () => undefined })).toBe(
      false,
    );
  });
});
