// tagging.test.ts — 自動タグ付けの単体テスト。実APIは叩かずfetchをフェイクにする。
import { describe, expect, it, vi } from "vitest";
import {
  analyzeNote,
  contentHash,
  MAX_TAGS,
  needsRetag,
  parseJunkFlag,
  parseTags,
  parseTitle,
  tagNote,
} from "./tagging";

function geminiReply(text: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  } as Response);
}

describe("contentHash", () => {
  it("同じ文字列は同じハッシュ、違えば(ほぼ)違うハッシュ", () => {
    expect(contentHash("あいうえお")).toBe(contentHash("あいうえお"));
    expect(contentHash("あいうえお")).not.toBe(contentHash("あいうえおか"));
  });
});

describe("needsRetag", () => {
  it("taggedHash未設定(未タグ付け)で本文があれば要タグ付け", () => {
    expect(needsRetag({ content: "本文" })).toBe(true);
  });

  it("本文が空なら対象外", () => {
    expect(needsRetag({ content: "   " })).toBe(false);
  });

  it("タグ付け時ハッシュと現在の本文が一致すればスキップ(変更なし)", () => {
    const content = "会議の議事録";
    expect(needsRetag({ content, taggedHash: contentHash(content) })).toBe(false);
  });

  it("タグ付け後に本文が変わっていれば要再タグ付け", () => {
    expect(needsRetag({ content: "変更後の本文", taggedHash: contentHash("元の本文") })).toBe(true);
  });
});

describe("parseTags", () => {
  it("カンマ/読点/改行区切りを配列にし、#や記号を外す", () => {
    expect(parseTags("#仕事, 会議、#議事録\n- 重要")).toEqual(["仕事", "会議", "議事録", "重要"]);
  });

  it("重複を除き、最大MAX_TAGS件に制限する", () => {
    const many = "a,b,c,d,e,f,g,a";
    expect(parseTags(many)).toHaveLength(MAX_TAGS);
  });
});

describe("tagNote", () => {
  it("Geminiの応答からタグ配列を返す", async () => {
    const fetch = geminiReply("旅行, 京都, 計画");
    expect(await tagNote("京都旅行の計画", "key", { fetch })).toEqual(["旅行", "京都", "計画"]);
  });

  it("本文が空ならAPIを呼ばず空配列", async () => {
    const fetch = vi.fn();
    expect(await tagNote("", "key", { fetch })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("タグ候補を渡すとプロンプトへ「優先的に選ぶ候補」として差し込まれる", async () => {
    const fetch = geminiReply("コーディング");
    await tagNote("実装した", "key", { fetch }, ["LLMへの指示", "コーディング"]);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    const prompt = body.contents[0].parts[0].text;
    expect(prompt).toContain("候補から選んで");
    expect(prompt).toContain("LLMへの指示, コーディング");
  });

  it("タグ候補が空ならプロンプトに候補の一節は入らない(従来どおり)", async () => {
    const fetch = geminiReply("旅行");
    await tagNote("京都旅行", "key", { fetch }, []);
    const prompt = JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(prompt).not.toContain("候補から選んで");
  });
});

describe("parseJunkFlag", () => {
  it("JUDGE行がJUNKならtrue", () => {
    expect(parseJunkFlag("TAGS: あ\nJUDGE: JUNK")).toBe(true);
  });

  it("JUDGE行がOKならfalse", () => {
    expect(parseJunkFlag("TAGS: 会議\nJUDGE: OK")).toBe(false);
  });

  it("JUDGE行が無い・曖昧ならfalse(安全側=NASに残す)", () => {
    expect(parseJunkFlag("タグ: 会議")).toBe(false);
  });
});

describe("analyzeNote", () => {
  it("TAGS/TITLE/JUDGE形式からタグ・タイトル・ゴミ判定を取り出す", async () => {
    const fetch = geminiReply("TAGS: 買い物, 牛乳\nTITLE: 買い物リスト\nJUDGE: OK");
    expect(await analyzeNote("牛乳を買う", "key", { fetch })).toEqual({
      tags: ["買い物", "牛乳"],
      junk: false,
      title: "買い物リスト",
    });
  });

  it("JUNK判定を拾う", async () => {
    const fetch = geminiReply("TAGS: テスト\nTITLE: 落書き\nJUDGE: JUNK");
    const result = await analyzeNote("あああ", "key", { fetch });
    expect(result.junk).toBe(true);
  });

  it("TITLE行が無ければtitleは空(タグは拾える)", async () => {
    const fetch = geminiReply("旅行, 京都");
    expect(await analyzeNote("京都旅行", "key", { fetch })).toEqual({
      tags: ["旅行", "京都"],
      junk: false,
      title: "",
    });
  });

  it("本文が空ならAPIを呼ばず {tags:[], junk:false, title:''}", async () => {
    const fetch = vi.fn();
    expect(await analyzeNote("   ", "key", { fetch })).toEqual({
      tags: [],
      junk: false,
      title: "",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("parseTitle", () => {
  it("先頭行の引用符・記号・#を除去して整える", () => {
    expect(parseTitle("「買い物リスト」")).toBe("買い物リスト");
    expect(parseTitle("# 会議メモ\n2行目")).toBe("会議メモ");
  });

  it("長すぎる場合は40字で切る", () => {
    expect(parseTitle("あ".repeat(50))).toHaveLength(40);
  });
});
