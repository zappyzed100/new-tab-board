// history.test.ts — history.ts(スナップショット判定)の単体テスト
import { describe, expect, it } from "vitest";
import {
  CHANGE_THRESHOLD_CHARS,
  exceedsChangeThreshold,
  exceedsMaxCap,
  isLargeDeletion,
  MAX_CAP_MS,
  MIN_FLOOR_MS,
  shouldSnapshot,
  SUMMARY_MAX_CHARS,
  summarizeSnapshot,
} from "./history";

describe("shouldSnapshot", () => {
  it("初回(lastSnapshotAt=null)は内容があれば刻む", () => {
    expect(
      shouldSnapshot({ now: 1000, lastSnapshotAt: null, lastContent: null, currentContent: "a" }),
    ).toBe(true);
  });

  it("内容が前回と同じ(dedup)ならスキップする", () => {
    expect(
      shouldSnapshot({
        now: 1000,
        lastSnapshotAt: 0,
        lastContent: "same",
        currentContent: "same",
      }),
    ).toBe(false);
  });

  it("最短フロア以内なら内容が変わっていても刻まない", () => {
    expect(
      shouldSnapshot({
        now: MIN_FLOOR_MS - 1,
        lastSnapshotAt: 0,
        lastContent: "a",
        currentContent: "b",
      }),
    ).toBe(false);
  });

  it("最短フロアを超えていれば刻む", () => {
    expect(
      shouldSnapshot({
        now: MIN_FLOOR_MS,
        lastSnapshotAt: 0,
        lastContent: "a",
        currentContent: "b",
      }),
    ).toBe(true);
  });

  it("本文が空(空白のみ含む)なら刻まない(空ノートは保存対象外)", () => {
    expect(
      shouldSnapshot({ now: 1000, lastSnapshotAt: null, lastContent: null, currentContent: "" }),
    ).toBe(false);
    expect(
      shouldSnapshot({
        now: 1000,
        lastSnapshotAt: null,
        lastContent: null,
        currentContent: "  \n\t ",
      }),
    ).toBe(false);
  });
});

describe("exceedsChangeThreshold", () => {
  it("閾値未満ならfalse", () => {
    expect(exceedsChangeThreshold("", "a".repeat(CHANGE_THRESHOLD_CHARS - 1))).toBe(false);
  });

  it("閾値以上ならtrue", () => {
    expect(exceedsChangeThreshold("", "a".repeat(CHANGE_THRESHOLD_CHARS))).toBe(true);
  });

  it("lastContentがnullでも動く(新規ノート)", () => {
    expect(exceedsChangeThreshold(null, "a".repeat(CHANGE_THRESHOLD_CHARS))).toBe(true);
  });
});

describe("exceedsMaxCap", () => {
  it("lastSnapshotAtがnullならfalse(まだ1回も刻んでいない)", () => {
    expect(exceedsMaxCap(MAX_CAP_MS, null)).toBe(false);
  });

  it("キャップ未満ならfalse", () => {
    expect(exceedsMaxCap(MAX_CAP_MS - 1, 0)).toBe(false);
  });

  it("キャップ以上ならtrue", () => {
    expect(exceedsMaxCap(MAX_CAP_MS, 0)).toBe(true);
  });
});

describe("isLargeDeletion", () => {
  it("非空→空(全選択からの削除)はtrue", () => {
    expect(isLargeDeletion("なにか書いてある", "")).toBe(true);
  });

  it("元々空なら空のままでもfalse(削除ではない)", () => {
    expect(isLargeDeletion("", "")).toBe(false);
  });

  it("閾値以上の一括削除はtrue", () => {
    expect(isLargeDeletion("a".repeat(CHANGE_THRESHOLD_CHARS + 10), "a".repeat(9))).toBe(true);
  });

  it("閾値未満の削除(空にはならない)はfalse——通常のアイドル保存に任せる", () => {
    expect(isLargeDeletion("a".repeat(50), "a".repeat(10))).toBe(false);
  });

  it("追加(長くなる)はfalse", () => {
    expect(isLargeDeletion("短い", "短い" + "a".repeat(CHANGE_THRESHOLD_CHARS))).toBe(false);
  });
});

describe("summarizeSnapshot", () => {
  it("無から生み出された文章(previousがnull)は頭(最初の非空行)だけを返す", () => {
    expect(summarizeSnapshot("\n\n  見出し行  \n本文", null)).toBe("見出し行");
  });

  it("前スナップショットが空(空→本文)も『無から』扱いで頭を返す((編集)を付けない)", () => {
    expect(summarizeSnapshot("はじめて書いた本文", "   ")).toBe("はじめて書いた本文");
  });

  it("既存を編集した作業は(編集)を冠して変更箇所(最初に異なる行)を返す", () => {
    const prev = "a\nb\nc";
    const cur = "a\nB変更\nc";
    expect(summarizeSnapshot(cur, prev)).toBe("(編集) B変更");
  });

  it("行の追加は(編集)付きで、追加された行を返す", () => {
    expect(summarizeSnapshot("a\nb\n新しい行", "a\nb")).toBe("(編集) 新しい行");
  });

  it("純粋な削除は(編集)(削除)付きで、消えた行を示す", () => {
    expect(summarizeSnapshot("a\nb", "a\nb\n消えた行")).toBe("(編集) (削除) 消えた行");
  });

  it("空白は畳み、長すぎる場合は省略記号を付ける(無からの頭)", () => {
    const long = "あ".repeat(SUMMARY_MAX_CHARS + 10);
    const result = summarizeSnapshot(long, null);
    expect(result.endsWith("…")).toBe(true);
    expect([...result].length).toBe(SUMMARY_MAX_CHARS + 1); // 60字 + 省略記号
  });

  it("本文が空なら(空)を返す", () => {
    expect(summarizeSnapshot("   \n  ", null)).toBe("(空)");
  });

  it("変更が無ければ(dedupで通常起きないが)本文の最初にフォールバックする((編集)は付く)", () => {
    expect(summarizeSnapshot("同じ\n本文", "同じ\n本文")).toBe("(編集) 同じ");
  });
});
