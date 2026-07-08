// links.test.ts — links.ts([[リンク]]パース・バックリンク索引)の単体テスト
import { describe, expect, it } from "vitest";
import { buildBacklinkIndex, extractLinkedTitles } from "./links";

describe("extractLinkedTitles", () => {
  it("本文中の[[リンク]]を重複無く抽出する", () => {
    expect(
      extractLinkedTitles("参照: [[会議メモ]] と [[買い物リスト]]。再度 [[会議メモ]]。"),
    ).toEqual(["会議メモ", "買い物リスト"]);
  });

  it("リンクが無ければ空配列を返す", () => {
    expect(extractLinkedTitles("普通の文章")).toEqual([]);
  });
});

describe("buildBacklinkIndex", () => {
  it("リンク先タイトルごとにリンク元ノートの一覧を作る", () => {
    const notes = [
      { id: "n1", title: "ノートA", content: "[[ノートB]]を参照" },
      { id: "n2", title: "ノートC", content: "[[ノートB]]と[[ノートA]]を参照" },
      { id: "n3", title: "ノートB", content: "リンク無し" },
    ];
    const index = buildBacklinkIndex(notes);
    expect(index.get("ノートB")).toEqual([
      { fromNoteId: "n1", fromNoteTitle: "ノートA" },
      { fromNoteId: "n2", fromNoteTitle: "ノートC" },
    ]);
    expect(index.get("ノートA")).toEqual([{ fromNoteId: "n2", fromNoteTitle: "ノートC" }]);
    expect(index.get("ノートC")).toBeUndefined();
  });
});
