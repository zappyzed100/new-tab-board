// tagCandidates.test.ts — タグ候補の純粋関数の単体テスト
import { describe, expect, it } from "vitest";
import { addTagCandidate, removeTagCandidate } from "./tagCandidates";

describe("addTagCandidate", () => {
  it("末尾に追加する", () => {
    expect(addTagCandidate(["コーディング"], "LLMへの指示")).toEqual([
      "コーディング",
      "LLMへの指示",
    ]);
  });

  it("前後の空白を除去する", () => {
    expect(addTagCandidate([], "  買い物 ")).toEqual(["買い物"]);
  });

  it("空・重複は無視して同一参照を返す", () => {
    const list = ["コーディング"];
    expect(addTagCandidate(list, "   ")).toBe(list);
    expect(addTagCandidate(list, "コーディング")).toBe(list);
  });
});

describe("removeTagCandidate", () => {
  it("指定した候補を取り除く", () => {
    expect(removeTagCandidate(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});
