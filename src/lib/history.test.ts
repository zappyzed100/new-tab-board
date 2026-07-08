// history.test.ts — history.ts(スナップショット判定)の単体テスト
import { describe, expect, it } from "vitest";
import {
  CHANGE_THRESHOLD_CHARS,
  exceedsChangeThreshold,
  exceedsMaxCap,
  MAX_CAP_MS,
  MIN_FLOOR_MS,
  shouldSnapshot,
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
