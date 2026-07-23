// noteImages.test.ts — ノート添付画像の参照(`![alt](nas:…)`)まわりの純粋関数の単体テスト
import { describe, expect, it } from "vitest";
import {
  attachedImagesForNote,
  imageExtensionFor,
  markdownImageReference,
  nasImageRelPath,
  nasRelPathFromSrc,
  referencedNasImages,
} from "./noteImages";

describe("imageExtensionFor", () => {
  it("既知のMIMEから拡張子を引く", () => {
    expect(imageExtensionFor("image/png")).toBe("png");
    expect(imageExtensionFor("image/jpeg")).toBe("jpg");
    expect(imageExtensionFor("IMAGE/WEBP")).toBe("webp");
  });

  it("未知のMIME・空はpngに倒す(貼り付け画像はPNG正規化される想定)", () => {
    expect(imageExtensionFor("application/octet-stream")).toBe("png");
    expect(imageExtensionFor("")).toBe("png");
  });
});

describe("nasImageRelPath / markdownImageReference", () => {
  it("images/<noteId>/<imageId>.<ext> に置く", () => {
    expect(nasImageRelPath("note-1", "abc", "png")).toBe("images/note-1/abc.png");
  });

  it("本文へ書く参照はMarkdown標準の画像記法(独自スキーム nas:)", () => {
    expect(markdownImageReference("images/note-1/abc.png")).toBe("![](nas:images/note-1/abc.png)");
    expect(markdownImageReference("images/n/a.png", "板書")).toBe("![板書](nas:images/n/a.png)");
  });
});

describe("nasRelPathFromSrc", () => {
  it("nas: 参照から相対パスを取り出す", () => {
    expect(nasRelPathFromSrc("nas:images/n/a.png")).toBe("images/n/a.png");
    expect(nasRelPathFromSrc("nas:/images/n/a.png")).toBe("images/n/a.png");
  });

  it("nas: 以外はこのモジュールの管轄外(null)", () => {
    expect(nasRelPathFromSrc("https://example.com/a.png")).toBeNull();
    expect(nasRelPathFromSrc("data:image/png;base64,AAAA")).toBeNull();
    expect(nasRelPathFromSrc("images/n/a.png")).toBeNull();
  });

  it("`..` を含む参照は拒否する(本文は人が編集できるテキストなのでここでも塞ぐ)", () => {
    expect(nasRelPathFromSrc("nas:../../secret.png")).toBeNull();
    expect(nasRelPathFromSrc("nas:images/../../secret.png")).toBeNull();
    expect(nasRelPathFromSrc("nas:")).toBeNull();
  });
});

describe("referencedNasImages", () => {
  it("本文が参照しているNAS画像を重複無く列挙する", () => {
    const content = [
      "板書のメモ",
      "![](nas:images/n1/a.png)",
      "![別の](nas:images/n1/b.png)",
      "![同じ](nas:images/n1/a.png)",
      "![外部](https://example.com/c.png)",
    ].join("\n");
    expect(referencedNasImages(content)).toEqual(["images/n1/a.png", "images/n1/b.png"]);
  });

  it("画像が無ければ空", () => {
    expect(referencedNasImages("ただの本文 [[リンク]] と $x$")).toEqual([]);
  });
});

describe("attachedImagesForNote", () => {
  const urls = new Map([
    ["images/n1/a.png", "blob:1"],
    ["images/n1/b.png", "blob:2"],
    ["images/n1/c.png", "blob:3"],
    ["images/other/z.png", "blob:9"],
  ]);

  it("そのノートのフォルダ(images/<noteId>/)にある画像だけを返す", () => {
    const result = attachedImagesForNote("n1", "", urls);
    expect(result).not.toContain("images/other/z.png");
    expect(result).toHaveLength(3);
  });

  it("本文で参照している順を先に、本文に無いものを相対パス順で後ろへ置く", () => {
    const content = "![](nas:images/n1/c.png)\n![](nas:images/n1/a.png)";
    expect(attachedImagesForNote("n1", content, urls)).toEqual([
      "images/n1/c.png",
      "images/n1/a.png",
      "images/n1/b.png",
    ]);
  });

  it("本文から参照テキストを消しても画像は消えない(貼ったのに確認できない状態を作らない)", () => {
    expect(attachedImagesForNote("n1", "参照を全部消した本文", urls)).toEqual([
      "images/n1/a.png",
      "images/n1/b.png",
      "images/n1/c.png",
    ]);
  });

  it("本文が参照していてもキャッシュに無ければ出さない(NAS未接続で読めなかった画像)", () => {
    expect(attachedImagesForNote("n1", "![](nas:images/n1/missing.png)", urls)).not.toContain(
      "images/n1/missing.png",
    );
  });

  it("キャッシュが空(NAS未登録)なら空", () => {
    expect(attachedImagesForNote("n1", "![](nas:images/n1/a.png)", new Map())).toEqual([]);
  });

  it("別ノートの画像は本文が参照していても混ざらない", () => {
    expect(attachedImagesForNote("n1", "![](nas:images/other/z.png)", urls)).not.toContain(
      "images/other/z.png",
    );
  });
});
