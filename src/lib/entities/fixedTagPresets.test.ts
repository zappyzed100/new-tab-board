// fixedTagPresets.test.ts — 固定タグプリセット(名前付きタグの組)の純粋操作の単体テスト
import { describe, expect, it } from "vitest";
import {
  activeFixedTags,
  addFixedTagPreset,
  parseFixedTagInput,
  removeFixedTagPreset,
} from "./fixedTagPresets";
import type { FixedTagPreset } from "../../types";

const presets: FixedTagPreset[] = [
  { id: "p1", name: "仕事", tags: ["仕事", "2026"] },
  { id: "p2", name: "勉強", tags: ["勉強"] },
];

describe("parseFixedTagInput", () => {
  it("空白区切りでタグに分ける", () => {
    expect(parseFixedTagInput("仕事 2026")).toEqual(["仕事", "2026"]);
  });

  it("カンマ・読点でも区切る", () => {
    expect(parseFixedTagInput("仕事, 2026、打合せ")).toEqual(["仕事", "2026", "打合せ"]);
  });

  it("#付きで書かれても正規化する(本文の#タグと一致させる)", () => {
    expect(parseFixedTagInput("#仕事 #2026")).toEqual(["仕事", "2026"]);
  });

  it("重複と空を落とす", () => {
    expect(parseFixedTagInput("  仕事   仕事  ")).toEqual(["仕事"]);
    expect(parseFixedTagInput("")).toEqual([]);
    expect(parseFixedTagInput("   ")).toEqual([]);
  });

  it("タグに使えない記号だけの語は消える", () => {
    expect(parseFixedTagInput("仕事 --- /")).toEqual(["仕事"]);
  });
});

describe("addFixedTagPreset", () => {
  it("末尾へ追加する(名前は前後空白を除く)", () => {
    expect(addFixedTagPreset(presets, " 旅行 ", ["旅行"], "p3")).toEqual([
      ...presets,
      { id: "p3", name: "旅行", tags: ["旅行"] },
    ]);
  });

  it("名前が空なら追加しない(元配列をそのまま返す)", () => {
    expect(addFixedTagPreset(presets, "  ", ["旅行"], "p3")).toBe(presets);
  });

  it("タグが0個なら追加しない(選んでも何も固定できないため)", () => {
    expect(addFixedTagPreset(presets, "旅行", [], "p3")).toBe(presets);
  });
});

describe("removeFixedTagPreset", () => {
  it("指定idを取り除く", () => {
    expect(removeFixedTagPreset(presets, "p1").map((p) => p.id)).toEqual(["p2"]);
  });

  it("無いidなら全部残る", () => {
    expect(removeFixedTagPreset(presets, "none")).toHaveLength(2);
  });
});

describe("activeFixedTags", () => {
  it("選択中プリセットのタグを返す", () => {
    expect(activeFixedTags(presets, "p1")).toEqual(["仕事", "2026"]);
  });

  it("未選択ならモードOFF(空配列)", () => {
    expect(activeFixedTags(presets, undefined)).toEqual([]);
    expect(activeFixedTags(presets, "")).toEqual([]);
  });

  it("消えたプリセットのidが残っていてもモードOFFへ倒す(絞り込まれたまま戻せない状態を作らない)", () => {
    expect(activeFixedTags(presets, "deleted")).toEqual([]);
  });
});
