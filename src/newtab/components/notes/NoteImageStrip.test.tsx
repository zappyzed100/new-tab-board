// NoteImageStrip.test.tsx — ノート下部の添付画像サムネイル帯の単体テスト
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NoteImageStrip } from "./NoteImageStrip";

afterEach(cleanup);

function strip(
  noteId: string,
  content: string,
  imageUrls?: ReadonlyMap<string, string>,
): HTMLElement {
  const { container } = render(
    <NoteImageStrip noteId={noteId} content={content} imageUrls={imageUrls} />,
  );
  return container;
}

const urls = new Map([
  ["images/n1/a.png", "blob:test/a"],
  ["images/n1/b.png", "blob:test/b"],
  ["images/other/z.png", "blob:test/z"],
]);

describe("NoteImageStrip", () => {
  it("そのノートの添付画像をサムネイルとして並べる", () => {
    const el = strip("n1", "![](nas:images/n1/a.png)", urls);
    const imgs = [...el.querySelectorAll("img")];
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["blob:test/a", "blob:test/b"]);
    expect(el.querySelector('[data-testid="note-images-n1"]')).not.toBeNull();
  });

  it("枚数を表示する(何枚貼ったか本文を読まずに分かる)", () => {
    expect(strip("n1", "", urls).textContent).toContain("添付画像 2枚");
  });

  it("サムネイルは原寸表示のため別タブで開けるリンクになっている", () => {
    const link = strip("n1", "", urls).querySelector<HTMLAnchorElement>(".note-image-thumb-link");
    expect(link?.getAttribute("href")).toBe("blob:test/a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.dataset.imagePath).toBe("images/n1/a.png");
  });

  it("別ノートの画像は混ざらない", () => {
    const el = strip("n1", "![](nas:images/other/z.png)", urls);
    expect(el.querySelector('img[src="blob:test/z"]')).toBeNull();
  });

  it("NASが未登録(キャッシュ空)なら帯ごと描画しない — 空の箱でレイアウトを崩さない", () => {
    expect(strip("n1", "![](nas:images/n1/a.png)", new Map()).innerHTML).toBe("");
    expect(strip("n1", "![](nas:images/n1/a.png)").innerHTML).toBe("");
  });

  it("そのノートに画像が1枚も無ければ描画しない", () => {
    expect(strip("no-image-note", "ただの本文", urls).innerHTML).toBe("");
  });
});
