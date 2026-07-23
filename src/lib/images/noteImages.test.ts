// noteImages.test.ts — ノート添付画像の参照(`![alt](nas:…)`)まわりの純粋関数の単体テスト
import { describe, expect, it } from "vitest";
import {
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
