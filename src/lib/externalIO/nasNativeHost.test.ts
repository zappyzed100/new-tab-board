// nasNativeHost.test.ts — nasNativeHost.ts(NASブリッジnative messagingクライアント)の単体テスト
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listNasTree,
  NAS_HOST_NAME,
  probeNasPath,
  readFileFromNas,
  rebuildNasIndex,
  searchNasHistory,
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
    fake.emitMessage({ type: "rebuild-result", ok: true, notes: 3, snapshots: 12 });
    expect(await promise).toEqual({ notes: 3, snapshots: 12 });
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
