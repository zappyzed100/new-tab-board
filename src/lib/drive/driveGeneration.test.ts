// driveGeneration.test.ts — driveGeneration.ts(Drive版の世代カウンタ)の単体テスト
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDriveFolderCacheForTests } from "./drive";
import { bumpDriveGeneration, readDriveGeneration } from "./driveGeneration";

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : ""),
  } as Response;
}

describe("readDriveGeneration", () => {
  beforeEach(async () => await resetDriveFolderCacheForTests());

  it("ファイル未作成なら0を返す", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "app-id" }] })) // app
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "board-id" }] })) // New Tab Board
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "data-id" }] })) // data
      .mockResolvedValueOnce(fakeResponse({ files: [] })); // generation.txt検索: 無し
    expect(await readDriveGeneration("tok", fetchImpl)).toBe(0);
  });

  it("既存ファイルの中身(整数文字列)を読む", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "app-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "board-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "data-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "gen-id" }] })) // generation.txt検索: 有り
      .mockResolvedValueOnce(fakeResponse("5")); // alt=media本文
    expect(await readDriveGeneration("tok", fetchImpl)).toBe(5);
  });

  it("壊れた中身(数字でない)は0とみなす", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "app-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "board-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "data-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "gen-id" }] }))
      .mockResolvedValueOnce(fakeResponse("not-a-number"));
    expect(await readDriveGeneration("tok", fetchImpl)).toBe(0);
  });

  it("HTTPエラー等の例外はnullを返す(接続失敗として扱う)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 500));
    expect(await readDriveGeneration("tok", fetchImpl)).toBeNull();
  });
});

describe("bumpDriveGeneration", () => {
  beforeEach(async () => await resetDriveFolderCacheForTests());

  it("未作成なら1(0+1)で新規作成する", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "app-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "board-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "data-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [] })) // generation.txt検索: 無し
      .mockResolvedValueOnce(fakeResponse({ id: "gen-id" })); // 新規作成POST
    const result = await bumpDriveGeneration("tok", fetchImpl);
    expect(result).toBe(1);
    const lastCall = fetchImpl.mock.calls.at(-1);
    expect(lastCall?.[1].method).toBe("POST");
  });

  it("既存(N)を読んでN+1へ更新する", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "app-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "board-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "data-id" }] }))
      .mockResolvedValueOnce(fakeResponse({ files: [{ id: "gen-id" }] })) // 検索: 有り
      .mockResolvedValueOnce(fakeResponse("7")) // 現在値
      .mockResolvedValueOnce(fakeResponse({})); // PATCH更新
    const result = await bumpDriveGeneration("tok", fetchImpl);
    expect(result).toBe(8);
    const lastCall = fetchImpl.mock.calls.at(-1);
    expect(lastCall?.[0]).toContain("gen-id");
    expect(lastCall?.[1].method).toBe("PATCH");
    expect(lastCall?.[1].body).toBe("8");
  });

  it("HTTPエラー等の例外はnullを返す(接続失敗として扱う)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({}, false, 500));
    expect(await bumpDriveGeneration("tok", fetchImpl)).toBeNull();
  });
});
