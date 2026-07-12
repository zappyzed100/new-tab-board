// noteAi.test.ts — 要約・TODO抽出の単体テスト。実APIは叩かずfetchをフェイクにする。
import { describe, expect, it, vi } from "vitest";
import { extractTodos, parseTodoLines, summarizeNote } from "./noteAi";

function geminiReply(text: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  } as Response);
}

describe("summarizeNote", () => {
  it("Geminiの応答をトリムして返す", async () => {
    const fetch = geminiReply("  これは要約です  ");
    expect(await summarizeNote("長い本文", "key", { fetch })).toBe("これは要約です");
  });

  it("本文が空ならAPIを呼ばずnull", async () => {
    const fetch = vi.fn();
    expect(await summarizeNote("   ", "key", { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("プロンプトに本文が含まれる", async () => {
    const fetch = geminiReply("ok");
    await summarizeNote("秘伝のタレ", "key", { fetch });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.contents[0].parts[0].text).toContain("秘伝のタレ");
  });
});

describe("parseTodoLines", () => {
  it("各種の箇条書き記号を外してTODO文字列にする", () => {
    const text = "- 牛乳を買う\n* 卵を買う\n・パンを買う\n1. 家賃を払う\n2) 掃除する";
    expect(parseTodoLines(text)).toEqual([
      "牛乳を買う",
      "卵を買う",
      "パンを買う",
      "家賃を払う",
      "掃除する",
    ]);
  });

  it("箇条書きでない行(前置き等)は無視する", () => {
    const text = "以下がTODOです:\n- タスクA\n\nそれ以外の説明文";
    expect(parseTodoLines(text)).toEqual(["タスクA"]);
  });

  it("TODOが無ければ空配列", () => {
    expect(parseTodoLines("特にありません")).toEqual([]);
  });
});

describe("extractTodos", () => {
  it("Geminiの箇条書き応答をTODO配列にする", async () => {
    const fetch = geminiReply("- 資料を作る\n- レビュー依頼");
    expect(await extractTodos("会議メモ", "key", { fetch })).toEqual([
      "資料を作る",
      "レビュー依頼",
    ]);
  });

  it("本文が空ならAPIを呼ばず空配列", async () => {
    const fetch = vi.fn();
    expect(await extractTodos("", "key", { fetch })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("応答が空(TODO無し)なら空配列", async () => {
    const fetch = geminiReply("");
    expect(await extractTodos("雑談メモ", "key", { fetch })).toEqual([]);
  });
});
