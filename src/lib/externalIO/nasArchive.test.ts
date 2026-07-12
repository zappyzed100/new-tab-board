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
  readArchivedSnapshot,
} from "./nasArchive";
import { gzipCompress, gzipDecompress } from "../history/gzip";
import { putSnapshot, getSnapshot } from "../storage/db";
import type { Snapshot } from "../../types";

const NAS_PATH = "Z:\\NAS\\backup";

// 2026-07-12T12:00:00Z(UTC正午)——どのタイムゾーンでもカレンダー日付が7/12でぶれない値。
const TS_2026_07_12 = Date.UTC(2026, 6, 12, 12, 0, 0);

function makeFakeNas(
  options: { probeOk?: boolean; writeShouldFail?: boolean; corruptOnWrite?: boolean } = {},
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
