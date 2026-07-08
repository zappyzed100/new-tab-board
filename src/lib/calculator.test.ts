// calculator.test.ts — calculator.ts(安全な算術式評価)の単体テスト
import { describe, expect, it } from "vitest";
import { evaluateExpression, evaluateLineIfCalculator } from "./calculator";

describe("evaluateExpression", () => {
  it("四則演算を計算できる", () => {
    expect(evaluateExpression("3 * 8")).toBe(24);
    expect(evaluateExpression("10 / 4")).toBe(2.5);
    expect(evaluateExpression("1 + 2 - 3")).toBe(0);
  });

  it("演算子の優先順位を正しく扱う", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20);
  });

  it("負数・小数を扱える", () => {
    expect(evaluateExpression("-5 + 2.5")).toBe(-2.5);
  });

  it("不正な式はnullを返す(evalを使わない安全性の確認)", () => {
    expect(evaluateExpression("alert(1)")).toBeNull();
    expect(evaluateExpression("1 +")).toBeNull();
    expect(evaluateExpression("")).toBeNull();
    expect(evaluateExpression("1 2 3")).toBeNull();
  });

  it("ゼロ除算はInfinityになるが、行検出側で弾く", () => {
    expect(evaluateExpression("1 / 0")).toBe(Infinity);
  });
});

describe("evaluateLineIfCalculator", () => {
  it("末尾が=の行から式と結果を取り出す", () => {
    expect(evaluateLineIfCalculator("3 * 8 =")).toEqual({ expr: "3 * 8", result: 24 });
  });

  it("=で終わらない行はnull", () => {
    expect(evaluateLineIfCalculator("3 * 8")).toBeNull();
  });

  it("=の前が空ならnull", () => {
    expect(evaluateLineIfCalculator("=")).toBeNull();
  });

  it("評価できない式(危険な入力含む)はnull", () => {
    expect(evaluateLineIfCalculator("alert(1) =")).toBeNull();
  });

  it("ゼロ除算(Infinity)はnullとして弾く", () => {
    expect(evaluateLineIfCalculator("1 / 0 =")).toBeNull();
  });
});
