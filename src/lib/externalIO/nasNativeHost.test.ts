// nasNativeHost.test.ts — nasNativeHost.ts(NASブリッジnative messagingクライアント)の単体テスト
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bumpNasGeneration,
  listNasTree,
  NAS_HOST_NAME,
  probeNasPath,
  readFileFromNas,
  readNasActive,
  readNasGeneration,
  rebuildNasIndex,
  searchNasHistory,
  searchNasNotes,
  topNasTags,
  writeFileToNas,
} from "./nasNativeHost";

afterEach(() => {
  vi.unstubAllGlobals();
});

type FakePort = {
  port: chrome.runtime.Port;
  emitMessage: (msg: unknown) => void;
  emitDisconnect: (lastErrorMessage?: string) => void;
  sentMessages: unknown[];
};

function makeFakePort(): FakePort {
  const messageListeners: ((msg: unknown) => void)[] = [];
  const disconnectListeners: (() => void)[] = [];
  const sentMessages: unknown[] = [];
  const port = {
    postMessage: (msg: unknown) => sentMessages.push(msg),
    disconnect: () => {},
    onMessage: { addListener: (fn: (msg: unknown) => void) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnectListeners.push(fn) },
    name: NAS_HOST_NAME,
  } as unknown as chrome.runtime.Port;

  return {
    port,
    sentMessages,
    emitMessage: (msg) => messageListeners.forEach((fn) => fn(msg)),
    emitDisconnect: (lastErrorMessage) => {
      vi.stubGlobal("chrome", {
        runtime: { lastError: lastErrorMessage ? { message: lastErrorMessage } : undefined },
      });
      disconnectListeners.forEach((fn) => fn());
    },
  };
}

describe("probeNasPath", () => {
  it("probe-resultのok:trueならtrueを返し、probeメッセージを送る", async () => {
    const fake = makeFakePort();
    const promise = probeNasPath("Z:\\NAS", () => fake.port);
    fake.emitMessage({ type: "probe-result", ok: true });
    expect(await promise).toBe(true);
    expect(fake.sentMessages).toEqual([{ type: "probe", path: "Z:\\NAS" }]);
  });

  it("probe-resultのok:falseならfalseを返す", async () => {
    const fake = makeFakePort();
    const promise = probeNasPath("Z:\\NAS", () => fake.port);
    fake.emitMessage({ type: "probe-result", ok: false, error: "not found" });
    expect(await promise).toBe(false);
  });

  it("connectNativeが例外を投げれば(host未インストール等)falseを返す", async () => {
    const result = await probeNasPath("Z:\\NAS", () => {
      throw new Error("not installed");
    });
    expect(result).toBe(false);
  });

  it("メッセージ無しで切断されればfalseを返す", async () => {
    const fake = makeFakePort();
    const promise = probeNasPath("Z:\\NAS", () => fake.port);
    fake.emitDisconnect("Specified native messaging host not found.");
    expect(await promise).toBe(false);
  });
});

describe("writeFileToNas", () => {
  it("write-resultのok:trueならtrueを返し、write-fileメッセージを送る", async () => {
    const fake = makeFakePort();
    const promise = writeFileToNas("Z:\\NAS", "foo.snapshot", "本文", () => fake.port);
    fake.emitMessage({ type: "write-result", ok: true });
    expect(await promise).toBe(true);
    expect(fake.sentMessages).toEqual([
      { type: "write-file", path: "Z:\\NAS", filename: "foo.snapshot", content: "本文" },
    ]);
  });

  it("write-resultのok:falseならfalseを返す", async () => {
    const fake = makeFakePort();
    const promise = writeFileToNas("Z:\\NAS", "foo.snapshot", "本文", () => fake.port);
    fake.emitMessage({ type: "write-result", ok: false, error: "disk full" });
    expect(await promise).toBe(false);
  });
});

describe("readFileFromNas", () => {
  it("read-resultのok:trueならcontentを返す", async () => {
    const fake = makeFakePort();
    const promise = readFileFromNas("Z:\\NAS", "foo.snapshot", () => fake.port);
    fake.emitMessage({ type: "read-result", ok: true, content: "本文" });
    expect(await promise).toBe("本文");
    expect(fake.sentMessages).toEqual([
      { type: "read-file", path: "Z:\\NAS", filename: "foo.snapshot" },
    ]);
  });

  it("read-resultのok:falseならnullを返す", async () => {
    const fake = makeFakePort();
    const promise = readFileFromNas("Z:\\NAS", "foo.snapshot", () => fake.port);
    fake.emitMessage({ type: "read-result", ok: false, error: "not found" });
    expect(await promise).toBeNull();
  });

  it("host未導入(接続失敗)ならnullを返す", async () => {
    const result = await readFileFromNas("Z:\\NAS", "foo.snapshot", () => {
      throw new Error("not installed");
    });
    expect(result).toBeNull();
  });
});

describe("rebuildNasIndex", () => {
  it("rebuild-resultのok:trueなら件数を返し、rebuild-indexメッセージを送る", async () => {
    const fake = makeFakePort();
    const promise = rebuildNasIndex("Z:\\NAS", () => fake.port);
    fake.emitMessage({ type: "rebuild-result", ok: true, notes: 3, dateNotes: 5, snapshots: 12 });
    expect(await promise).toEqual({ notes: 3, dateNotes: 5, snapshots: 12 });
    expect(fake.sentMessages).toEqual([{ type: "rebuild-index", path: "Z:\\NAS" }]);
  });

  it("ok:falseならnull", async () => {
    const fake = makeFakePort();
    const promise = rebuildNasIndex("Z:\\NAS", () => fake.port);
    fake.emitMessage({ type: "rebuild-result", ok: false, error: "boom" });
    expect(await promise).toBeNull();
  });
});

describe("listNasTree", () => {
  it("list-tree-resultのfilesを返し、path/subdirを送る", async () => {
    const fake = makeFakePort();
    const promise = listNasTree("Z:\\NAS", "library", () => fake.port);
    fake.emitMessage({ type: "list-tree-result", ok: true, files: ["メモ.md", "仕事/計画.md"] });
    expect(await promise).toEqual(["メモ.md", "仕事/計画.md"]);
    expect(fake.sentMessages).toEqual([{ type: "list-tree", path: "Z:\\NAS", subdir: "library" }]);
  });

  it("ok:falseならnull", async () => {
    const fake = makeFakePort();
    const promise = listNasTree("Z:\\NAS", "library", () => fake.port);
    fake.emitMessage({ type: "list-tree-result", ok: false, error: "boom" });
    expect(await promise).toBeNull();
  });
});

describe("searchNasHistory", () => {
  it("search-resultのok:trueならrowsを返し、tags/text/modeを送る", async () => {
    const fake = makeFakePort();
    const promise = searchNasHistory(
      "Z:\\NAS",
      { tags: ["登山"], text: "高尾山", mode: "and" },
      () => fake.port,
    );
    const rows = [
      { note_id: "n1", title: "登山ノート", timestamp: 1783830340293, snippet: "…高尾山…" },
    ];
    fake.emitMessage({ type: "search-result", ok: true, rows });
    expect(await promise).toEqual(rows);
    expect(fake.sentMessages).toEqual([
      { type: "search", path: "Z:\\NAS", tags: ["登山"], text: "高尾山", mode: "and" },
    ]);
  });

  it("引数省略時は tags:[] text:'' mode:'and' を送る", async () => {
    const fake = makeFakePort();
    const promise = searchNasHistory("Z:\\NAS", {}, () => fake.port);
    fake.emitMessage({ type: "search-result", ok: true, rows: [] });
    expect(await promise).toEqual([]);
    expect(fake.sentMessages).toEqual([
      { type: "search", path: "Z:\\NAS", tags: [], text: "", mode: "and" },
    ]);
  });

  it("ok:false(index.db無し等)ならnull", async () => {
    const fake = makeFakePort();
    const promise = searchNasHistory("Z:\\NAS", { text: "x" }, () => fake.port);
    fake.emitMessage({ type: "search-result", ok: false, error: "index.db が無い" });
    expect(await promise).toBeNull();
  });
});

describe("topNasTags", () => {
  it("top-tags-resultのtagsを返し、limit付きで送る", async () => {
    const fake = makeFakePort();
    const promise = topNasTags("Z:\\NAS", 20, () => fake.port);
    const tags = [
      { tag: "登山", count: 2 },
      { tag: "計画", count: 1 },
    ];
    fake.emitMessage({ type: "top-tags-result", ok: true, tags });
    expect(await promise).toEqual(tags);
    expect(fake.sentMessages).toEqual([{ type: "top-tags", path: "Z:\\NAS", limit: 20 }]);
  });

  it("ok:falseならnull", async () => {
    const fake = makeFakePort();
    const promise = topNasTags("Z:\\NAS", 50, () => fake.port);
    fake.emitMessage({ type: "top-tags-result", ok: false, error: "index.db が無い" });
    expect(await promise).toBeNull();
  });
});

describe("searchNasNotes", () => {
  it("tags/text/mode/from/to を送り、rowsを返す", async () => {
    const fake = makeFakePort();
    const promise = searchNasNotes(
      "Z:\\NAS",
      {
        tags: ["登山"],
        text: "高尾山",
        mode: "and",
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
      },
      () => fake.port,
    );
    const rows = [
      {
        note_id: "a",
        title: "登山計画",
        created_at: "2026-07-01T00:00:00.000Z",
        content: "高尾山へ行く",
        snippet: "高尾山へ行く",
      },
    ];
    fake.emitMessage({ type: "search-notes-result", ok: true, rows });
    expect(await promise).toEqual(rows);
    expect(fake.sentMessages).toEqual([
      {
        type: "search-notes",
        path: "Z:\\NAS",
        tags: ["登山"],
        text: "高尾山",
        mode: "and",
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("from/to未指定なら送らない(無制限)", async () => {
    const fake = makeFakePort();
    const promise = searchNasNotes("Z:\\NAS", { tags: ["x"] }, () => fake.port);
    fake.emitMessage({ type: "search-notes-result", ok: true, rows: [] });
    expect(await promise).toEqual([]);
    expect(fake.sentMessages).toEqual([
      { type: "search-notes", path: "Z:\\NAS", tags: ["x"], text: "", mode: "and" },
    ]);
  });

  it("ok:falseならnull", async () => {
    const fake = makeFakePort();
    const promise = searchNasNotes("Z:\\NAS", { text: "x" }, () => fake.port);
    fake.emitMessage({ type: "search-notes-result", ok: false, error: "index.db が無い" });
    expect(await promise).toBeNull();
  });
});

describe("世代同期(read/bump-generation, read-active)", () => {
  it("readNasGeneration は世代番号を返し、read-generationを送る", async () => {
    const fake = makeFakePort();
    const promise = readNasGeneration("Z:\\NAS", () => fake.port);
    fake.emitMessage({ type: "generation-result", ok: true, generation: 3 });
    expect(await promise).toBe(3);
    expect(fake.sentMessages).toEqual([{ type: "read-generation", path: "Z:\\NAS" }]);
  });

  it("bumpNasGeneration はexpectedを添えてbump-generationを送り、成功時は新世代を返す", async () => {
    const fake = makeFakePort();
    const promise = bumpNasGeneration("Z:\\NAS", 3, () => fake.port);
    fake.emitMessage({ type: "generation-result", ok: true, generation: 4 });
    expect(await promise).toEqual({ ok: true, generation: 4 });
    expect(fake.sentMessages).toEqual([{ type: "bump-generation", path: "Z:\\NAS", expected: 3 }]);
  });

  it(
    "bumpNasGeneration はCAS不一致(stale)ならok:false,stale:trueと現在世代を返す" +
      "(2026-07-19: 他タブが既に世代を進めていた場合、無条件bumpだと古いノート一覧を" +
      "NASへ書き戻してしまうため、呼び出し側がまずpullし直せるようにする)",
    async () => {
      const fake = makeFakePort();
      const promise = bumpNasGeneration("Z:\\NAS", 3, () => fake.port);
      fake.emitMessage({ type: "generation-result", ok: false, stale: true, generation: 5 });
      expect(await promise).toEqual({ ok: false, stale: true, generation: 5 });
    },
  );

  it("bumpNasGeneration は通信失敗(host未導入等)ならnull", async () => {
    const fake = makeFakePort();
    const promise = bumpNasGeneration("Z:\\NAS", 3, () => fake.port);
    fake.emitDisconnect();
    expect(await promise).toBeNull();
  });

  it("generation-resultのok:falseならnull", async () => {
    const fake = makeFakePort();
    const promise = readNasGeneration("Z:\\NAS", () => fake.port);
    fake.emitMessage({ type: "generation-result", ok: false, error: "base欠如" });
    expect(await promise).toBeNull();
  });

  it("readNasActive はactive/の.md一覧(名前+内容)を返す", async () => {
    const fake = makeFakePort();
    const promise = readNasActive("Z:\\NAS", () => fake.port);
    const files = [{ filename: "n1.md", content: "---\nid: n1\n---\n\n本文" }];
    fake.emitMessage({ type: "read-active-result", ok: true, files });
    expect(await promise).toEqual(files);
    expect(fake.sentMessages).toEqual([{ type: "read-active", path: "Z:\\NAS" }]);
  });

  it("read-active-resultのok:falseならnull", async () => {
    const fake = makeFakePort();
    const promise = readNasActive("Z:\\NAS", () => fake.port);
    fake.emitMessage({ type: "read-active-result", ok: false });
    expect(await promise).toBeNull();
  });
});
