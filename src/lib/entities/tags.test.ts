// tags.test.ts — tags.ts(#タグ抽出 / タグ語彙構築)の単体テスト
import { describe, expect, it } from "vitest";
import { buildTagVocabulary, extractTags, resolveNoteTags } from "./tags";

describe("extractTags", () => {
  it("本文中の#タグを重複無く抽出する", () => {
    expect(extractTags("今日は #買い物 と #掃除 をした。#買い物 は終わった。")).toEqual([
      "買い物",
      "掃除",
    ]);
  });

  it("英数字のタグも抽出できる", () => {
    expect(extractTags("#todo と #project_x")).toEqual(["todo", "project_x"]);
  });

  it("タグが無ければ空配列を返す", () => {
    expect(extractTags("タグの無い普通の文章")).toEqual([]);
  });

  it("URLのハッシュフラグメント等の# 単体は無視する(英数字が続かないため)", () => {
    expect(extractTags("見出し # だけ")).toEqual([]);
  });

  it("Markdownの見出し(# の後に空白)はタグにしない", () => {
    expect(extractTags("# 見出し\n## 小見出し\n本文 #実タグ")).toEqual(["実タグ"]);
  });

  it("###見出し のように#が連続しても、2つ目以降の#はタグの始まりにしない", () => {
    expect(extractTags("###見出し")).toEqual([]);
  });

  it("URLのフラグメントを拾わない(単語の途中の#はタグではない)", () => {
    expect(extractTags("参考 https://example.com/doc#section3 を読む")).toEqual([]);
  });

  it("コードブロック内の#コメントはタグにしない", () => {
    const content = ["#本物", "", "```python", "#!/usr/bin/env python", "# コメント", "```"].join(
      "\n",
    );
    expect(extractTags(content)).toEqual(["本物"]);
  });

  it("インラインコード内の#はタグにしない", () => {
    expect(extractTags("シェルの `#!/bin/sh` について #シェル")).toEqual(["シェル"]);
  });

  it("閉じられていないコードブロックは末尾までコード扱いにする(取りこぼしより誤検出を防ぐ)", () => {
    expect(extractTags("#前\n```\n#中 #後")).toEqual(["前"]);
  });

  it("括弧の直後の#もタグとして拾う", () => {
    expect(extractTags("(#数学) 「#物理」")).toEqual(["数学", "物理"]);
  });
});

describe("resolveNoteTags", () => {
  it("本文の手動タグ(先)とGeminiの自動タグ(後)を重複除去して合流する", () => {
    expect(resolveNoteTags({ content: "#線形代数 のノート", tags: ["数学", "線形代数"] })).toEqual([
      "線形代数",
      "数学",
    ]);
  });

  it("Geminiのタグが全置換されても本文の手動タグは残る(本文が正本)", () => {
    const note = { content: "#暗記 する内容", tags: ["別のタグ"] };
    // analyzeNote の結果で tags を丸ごと置き換えた状況を再現する
    expect(resolveNoteTags({ ...note, tags: ["まったく別"] })).toEqual(["暗記", "まったく別"]);
  });

  it("片方が空でも動く", () => {
    expect(resolveNoteTags({ content: "#手動だけ" })).toEqual(["手動だけ"]);
    expect(resolveNoteTags({ tags: ["自動だけ"] })).toEqual(["自動だけ"]);
    expect(resolveNoteTags({})).toEqual([]);
  });
});

describe("buildTagVocabulary", () => {
  const notes = [
    { tags: ["登山", "旅行"] },
    { tags: ["登山", "料理"] },
    { tags: ["登山"] },
    { tags: ["旅行"] },
  ];

  it("候補が先頭、続いて既存タグを頻度降順で並べる", () => {
    // 頻度: 登山3, 旅行2, 料理1。候補は最優先。
    expect(buildTagVocabulary(["買い物", "登山"], notes)).toEqual([
      "買い物",
      "登山", // 候補にあるので既存側では重複除去
      "旅行",
      "料理",
    ]);
  });

  it("重複と空白を除く(候補と既存で被っても1回)", () => {
    expect(buildTagVocabulary(["  ", "旅行", "旅行"], notes)).toEqual(["旅行", "登山", "料理"]);
  });

  it("最大 limit 個で切る(ユーザー指示: 200まで。ここは境界を小さくして検証)", () => {
    const many = Array.from({ length: 10 }, (_, i) => `c${i}`);
    expect(buildTagVocabulary(many, notes, 3)).toEqual(["c0", "c1", "c2"]);
  });

  it("候補が上限を占める場合、既存タグは足さない", () => {
    expect(buildTagVocabulary(["a", "b"], notes, 2)).toEqual(["a", "b"]);
  });

  it("既定の上限は200", () => {
    const candidates = Array.from({ length: 250 }, (_, i) => `t${i}`);
    expect(buildTagVocabulary(candidates, []).length).toBe(200);
  });
});
