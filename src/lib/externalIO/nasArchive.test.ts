// nasArchive.test.ts — nasArchive.ts(SSD→NAS store-and-forward)の単体テスト
// FileSystemDirectoryHandleはフェイクを自作(ブラウザ専用APIでfake-indexeddb相当が無いため)。
// 実FileSystemDirectoryHandleは関数プロパティを持つホストオブジェクトで
// fake-indexeddbの構造化複製検査を通らないため、getNasDirectoryHandleは依存注入で
// フェイクに差し替える(実db.ts経由のstoreはこのファイルでは使わない)。
import { describe, expect, it } from "vitest";
import {
  flushAllToNas,
  flushSnapshotToNas,
  getSnapshotBody,
  probeNasReachable,
  readArchivedSnapshot,
} from "./nasArchive";
import { putSnapshot, getSnapshot } from "../storage/db";
import type { Snapshot } from "../../types";

type FakeFile = { text: () => Promise<string> };
type FakeWritable = { write: (data: string) => Promise<void>; close: () => Promise<void> };

function makeFakeDir(
  options: {
    permission?: "granted" | "denied" | "prompt";
    writeShouldFail?: boolean;
    corruptOnWrite?: boolean;
  } = {},
) {
  const files = new Map<string, string>();
  return {
    files,
    queryPermission: async () => options.permission ?? "granted",
    getFileHandle: async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!opts?.create) throw new Error(`not found: ${name}`);
        files.set(name, "");
      }
      return {
        createWritable: async (): Promise<FakeWritable> => ({
          write: async (data: string) => {
            if (options.writeShouldFail) throw new Error("write failed");
            files.set(name, options.corruptOnWrite ? `${data}CORRUPT` : data);
          },
          close: async () => {},
        }),
        getFile: async (): Promise<FakeFile> => ({
          text: async () => files.get(name) ?? "",
        }),
      };
    },
  } as unknown as FileSystemDirectoryHandle;
}

const baseSnapshot: Snapshot = {
  id: "s1",
  noteId: "n1",
  timestamp: 1000,
  content: "gzip-base64-blob",
  archived: false,
};

describe("ハンドルが無い場合(未注入=実getNasDirectoryHandleが未設定を返す)", () => {
  it("flushAllToNasは0/0を返す", async () => {
    expect(await flushAllToNas()).toEqual({ flushed: 0, failed: 0 });
  });

  it("readArchivedSnapshotはnullを返す", async () => {
    expect(await readArchivedSnapshot("never-set.snapshot")).toBeNull();
  });
});

describe("probeNasReachable", () => {
  it("読み書きに成功すればtrue", async () => {
    expect(await probeNasReachable(makeFakeDir())).toBe(true);
  });

  it("書き込みが失敗すればfalse", async () => {
    expect(await probeNasReachable(makeFakeDir({ writeShouldFail: true }))).toBe(false);
  });
});

describe("flushSnapshotToNas", () => {
  it("contentが無ければfalse(二重フラッシュ防御)", async () => {
    const dir = makeFakeDir();
    expect(await flushSnapshotToNas(dir, { ...baseSnapshot, content: undefined })).toBe(false);
  });

  it("書き込み+再読込一致でtrue", async () => {
    const dir = makeFakeDir();
    expect(await flushSnapshotToNas(dir, baseSnapshot)).toBe(true);
  });

  it("再読込内容が一致しなければfalse", async () => {
    const dir = makeFakeDir({ corruptOnWrite: true });
    expect(await flushSnapshotToNas(dir, baseSnapshot)).toBe(false);
  });
});

describe("flushAllToNas(ハンドルを依存注入)", () => {
  it("権限が無ければ0/0(フラッシュしない)", async () => {
    await putSnapshot({ ...baseSnapshot, id: "s-perm", content: "body" });
    const dir = makeFakeDir({ permission: "denied" });
    expect(await flushAllToNas({ getNasDirectoryHandle: async () => dir })).toEqual({
      flushed: 0,
      failed: 0,
    });
  });

  it("未archivedのみフラッシュし、既archived済みはスキップする", async () => {
    // getAllSnapshotsは全ノート横断のため、他テストが残した未archivedスナップショットの
    // 影響を受けないよう、集計件数ではなく対象スナップショット自体の状態を検証する。
    await putSnapshot({ ...baseSnapshot, id: "s-pending", content: "body-1" });
    await putSnapshot({
      id: "s-already",
      noteId: "n1",
      timestamp: 2000,
      archived: true,
      archivePath: "n1-2000-s-already.snapshot",
    });
    const dir = makeFakeDir();
    const result = await flushAllToNas({ getNasDirectoryHandle: async () => dir });
    expect(result.failed).toBe(0);

    const flushed = await getSnapshot("s-pending");
    expect(flushed?.archived).toBe(true);
    expect(flushed?.content).toBeUndefined();
    expect(flushed?.archivePath).toBeTruthy();

    const already = await getSnapshot("s-already");
    expect(already?.archivePath).toBe("n1-2000-s-already.snapshot"); // 上書きされず据え置き
  });

  it("readArchivedSnapshot/getSnapshotBodyでフラッシュ後も本文を読み戻せる", async () => {
    await putSnapshot({ ...baseSnapshot, id: "s-roundtrip", content: "body-2" });
    const dir = makeFakeDir();
    const deps = { getNasDirectoryHandle: async () => dir };
    await flushAllToNas(deps);
    const flushed = await getSnapshot("s-roundtrip");
    expect(flushed).toBeDefined();

    const body = await getSnapshotBody(flushed!, deps);
    expect(body).toBe("body-2");
    expect(await readArchivedSnapshot(flushed!.archivePath!, deps)).toBe("body-2");
  });

  it("readArchivedSnapshotは存在しないファイルパスならnull", async () => {
    const dir = makeFakeDir();
    expect(
      await readArchivedSnapshot("missing.snapshot", { getNasDirectoryHandle: async () => dir }),
    ).toBeNull();
  });
});

describe("getSnapshotBody", () => {
  it("contentがあればNASを読まずそのまま返す", async () => {
    const withContent: Snapshot = { ...baseSnapshot, content: "raw" };
    expect(await getSnapshotBody(withContent)).toBe("raw");
  });

  it("archivedでもarchivePathが無ければnull", async () => {
    const noPath: Snapshot = { ...baseSnapshot, content: undefined, archived: true };
    expect(await getSnapshotBody(noPath)).toBeNull();
  });
});
