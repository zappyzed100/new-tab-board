// nasImageStore.test.ts — ノート添付画像のNAS入出力の単体テスト(実NAS・実IndexedDBは経由しない)
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  base64ToBlob,
  blobToBase64,
  loadAllNoteImagesFromNas,
  mimeTypeForRelPath,
  saveNoteImageToNas,
  type NasImageDeps,
} from "./nasImageStore";

function pngBlob(bytes: number[] = [1, 2, 3, 250]): Blob {
  return new Blob([new Uint8Array(bytes)], { type: "image/png" });
}

describe("blobToBase64 / base64ToBlob", () => {
  it("バイト列がそのまま往復する(utf-8経路に載せると壊れる値を含む)", async () => {
    const original = new Uint8Array([0, 1, 127, 128, 200, 255]);
    const encoded = await blobToBase64(new Blob([original], { type: "image/png" }));
    const restored = new Uint8Array(await base64ToBlob(encoded, "image/png").arrayBuffer());
    expect([...restored]).toEqual([...original]);
  });

  it("大きい画像でもRangeErrorにならない(引数展開の上限を超える長さ)", async () => {
    const big = new Uint8Array(200_000).fill(7);
    const encoded = await blobToBase64(new Blob([big]));
    expect(base64ToBlob(encoded, "image/png").size).toBe(big.length);
  });
});

describe("mimeTypeForRelPath", () => {
  it("拡張子からMIMEを引く(大文字も)", () => {
    expect(mimeTypeForRelPath("images/n/a.png")).toBe("image/png");
    expect(mimeTypeForRelPath("images/n/a.JPG")).toBe("image/jpeg");
    expect(mimeTypeForRelPath("images/n/a.webp")).toBe("image/webp");
  });

  it("不明な拡張子は octet-stream(表示されないが壊しもしない)", () => {
    expect(mimeTypeForRelPath("images/n/a.xyz")).toBe("application/octet-stream");
  });
});

describe("saveNoteImageToNas", () => {
  it("NASへ書き、本文から参照する相対パスを返す", async () => {
    const writeBinary = vi.fn().mockResolvedValue(true);
    const deps: NasImageDeps = {
      getFolderPath: async () => "Z:/NAS",
      writeBinary,
      newImageId: () => "img-1",
    };
    const relPath = await saveNoteImageToNas("note-1", pngBlob(), deps);
    expect(relPath).toBe("images/note-1/img-1.png");
    expect(writeBinary).toHaveBeenCalledWith(
      "Z:/NAS",
      "images/note-1/img-1.png",
      expect.any(String),
    );
  });

  it("NASフォルダが未登録なら保存しない(=本文に参照も書かれない)", async () => {
    const writeBinary = vi.fn().mockResolvedValue(true);
    const relPath = await saveNoteImageToNas("note-1", pngBlob(), {
      getFolderPath: async () => null,
      writeBinary,
    });
    expect(relPath).toBeNull();
    expect(writeBinary).not.toHaveBeenCalled();
  });

  it("書き込みに失敗したらnull(参照だけ残って永久に表示できない状態を作らない)", async () => {
    const relPath = await saveNoteImageToNas("note-1", pngBlob(), {
      getFolderPath: async () => "Z:/NAS",
      writeBinary: async () => false,
      newImageId: () => "img-1",
    });
    expect(relPath).toBeNull();
  });
});

describe("loadAllNoteImagesFromNas", () => {
  it("NASの images/ を全部読んで 相対パス→Blob のマップにする", async () => {
    const images = await loadAllNoteImagesFromNas({
      getFolderPath: async () => "Z:/NAS",
      listImages: async () => ["images/n1/a.png", "images/n2/b.webp"],
      readBinary: async (_p, filename) =>
        blobToBase64(pngBlob(filename.endsWith("a.png") ? [1, 2] : [3, 4, 5])),
    });
    expect([...images.keys()]).toEqual(["images/n1/a.png", "images/n2/b.webp"]);
    expect(images.get("images/n1/a.png")?.type).toBe("image/png");
    expect(images.get("images/n2/b.webp")?.type).toBe("image/webp");
    expect(images.get("images/n2/b.webp")?.size).toBe(3);
  });

  it("NAS未登録なら読みに行かず空(NASブリッジへ接続しない)", async () => {
    const listImages = vi.fn();
    const images = await loadAllNoteImagesFromNas({
      getFolderPath: async () => null,
      listImages,
    });
    expect(images.size).toBe(0);
    expect(listImages).not.toHaveBeenCalled();
  });

  it("一覧取得に失敗(host未導入/NAS未接続)しても例外にせず空を返す", async () => {
    const images = await loadAllNoteImagesFromNas({
      getFolderPath: async () => "Z:/NAS",
      listImages: async () => null,
    });
    expect(images.size).toBe(0);
  });

  it("1枚読めなくても残りは読み込む", async () => {
    const images = await loadAllNoteImagesFromNas({
      getFolderPath: async () => "Z:/NAS",
      listImages: async () => ["images/n/broken.png", "images/n/ok.png"],
      readBinary: async (_p, filename) =>
        filename.endsWith("broken.png") ? null : blobToBase64(pngBlob()),
    });
    expect([...images.keys()]).toEqual(["images/n/ok.png"]);
  });
});
