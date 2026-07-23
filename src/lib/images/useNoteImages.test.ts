// useNoteImages.test.ts — ノート添付画像の揮発キャッシュhookの単体テスト
// 実NASの代わりにフェイクを注入する。object URLはjsdomに無いのでスタブする。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useNoteImages } from "./useNoteImages";
import { blobToBase64 } from "./nasImageStore";
import type { NasImageDeps } from "./nasImageStore";

let created: string[] = [];
let revoked: string[] = [];

beforeEach(() => {
  created = [];
  revoked = [];
  let seq = 0;
  // jsdomはobject URLを持たない。生成/解放の呼ばれ方まで検証したいので自前で数える。
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:test/${(seq += 1)}`;
    created.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function png(bytes: number[] = [1, 2, 3]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

describe("useNoteImages", () => {
  it("起動時にNASの画像を読み、NAS相対パス→object URL のキャッシュを配る", async () => {
    const deps: NasImageDeps = {
      getFolderPath: async () => "Z:/NAS",
      listImages: async () => ["images/n1/a.png", "images/n2/b.png"],
      readBinary: async () => blobToBase64(png()),
    };
    const { result } = renderHook(() => useNoteImages(deps));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect([...result.current.urls.keys()]).toEqual(["images/n1/a.png", "images/n2/b.png"]);
    expect(created).toHaveLength(2);
  });

  it("NASが未登録ならキャッシュは空のまま(=ノートに画像は出ない)", async () => {
    const listImages = vi.fn();
    const { result } = renderHook(() =>
      useNoteImages({ getFolderPath: async () => null, listImages }),
    );

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.urls.size).toBe(0);
    expect(listImages).not.toHaveBeenCalled();
  });

  it("attachはNASへ保存し、NASを読み直さずにキャッシュへ足す", async () => {
    const writeBinary = vi.fn().mockResolvedValue(true);
    const readBinary = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() =>
      useNoteImages({
        getFolderPath: async () => "Z:/NAS",
        listImages: async () => [],
        readBinary,
        writeBinary,
        newImageId: () => "img-1",
        now: () => new Date(2026, 6, 23).getTime(),
      }),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let relPath: string | null = null;
    await act(async () => {
      relPath = await result.current.attach("note-1", png());
    });

    expect(relPath).toBe("images/note-1/2026-07-23-img-1.png");
    expect(writeBinary).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(result.current.urls.get("images/note-1/2026-07-23-img-1.png")).toBeDefined(),
    );
    expect(readBinary).not.toHaveBeenCalled(); // 保存直後は手元のblobをそのまま見せる
  });

  it("NAS未登録ならattachはnullを返し、キャッシュも汚さない", async () => {
    const { result } = renderHook(() => useNoteImages({ getFolderPath: async () => null }));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let relPath: string | null = "not-set";
    await act(async () => {
      relPath = await result.current.attach("note-1", png());
    });
    expect(relPath).toBeNull();
    expect(result.current.urls.size).toBe(0);
  });

  it("アンマウントで生成したobject URLを解放する(タブを開き続けても漏らさない)", async () => {
    const { result, unmount } = renderHook(() =>
      useNoteImages({
        getFolderPath: async () => "Z:/NAS",
        listImages: async () => ["images/n1/a.png"],
        readBinary: async () => blobToBase64(png()),
      }),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(created).toHaveLength(1);

    unmount();
    expect(revoked).toEqual(created);
  });
});
