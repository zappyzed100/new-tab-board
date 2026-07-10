// search.test.ts — search.ts(転置インデックスの構築・検索)の単体テスト(fake-indexeddb使用)
import { describe, expect, it } from "vitest";
import { indexSnapshot, searchSnapshotIds } from "./search";

describe("indexSnapshot / searchSnapshotIds", () => {
  it("1トークンで一致するスナップショットを検索できる", async () => {
    await indexSnapshot("s1", "todo list for today");
    await indexSnapshot("s2", "grocery shopping list");
    expect(await searchSnapshotIds("list")).toEqual(expect.arrayContaining(["s1", "s2"]));
  });

  it("複数トークンはAND検索になる", async () => {
    await indexSnapshot("s3", "apple banana cherry");
    await indexSnapshot("s4", "apple banana");
    const result = await searchSnapshotIds("apple cherry");
    expect(result).toEqual(["s3"]);
  });

  it("一致しないクエリは空配列を返す", async () => {
    expect(await searchSnapshotIds("no-such-word-xyz")).toEqual([]);
  });

  it("空クエリは空配列を返す", async () => {
    expect(await searchSnapshotIds("")).toEqual([]);
  });

  it("#タグも単語として検索できる", async () => {
    await indexSnapshot("s5", "買い物リスト #買い物 #重要");
    expect(await searchSnapshotIds("重要")).toEqual(expect.arrayContaining(["s5"]));
  });
});
