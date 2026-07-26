// @vitest-environment jsdom
// watchdog.test.ts — 「固まった」証拠を残す常駐ウォッチドッグの単体テスト。
// 時間はフェイクタイマーと performance.now のスタブで完全に決定的に動かす(実時間を待たない)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiagnostics,
  DIAG_LOG_MAX,
  formatDiagnosticsLog,
  readDiagnostics,
  startWatchdog,
  summarizeDiagnostics,
  type DiagEvent,
} from "./watchdog";
import { saveDiagnosticsLog } from "../storage/storage";
import { logOp, SLOW_OP_MS } from "./log";

/** performance.now の戻り値を手で進めるためのスタブ(単調増加の仮想時計)。 */
let perfNow = 0;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
  perfNow = 0;
  vi.spyOn(performance, "now").mockImplementation(() => perfNow);
  await clearDiagnostics();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 仮想時計と心拍を一緒に進める。realMs=実際に経過した時間、tickMs=進める心拍の回数ぶん。 */
async function advance(realMs: number, timerMs = realMs) {
  perfNow += realMs;
  await vi.advanceTimersByTimeAsync(timerMs);
}

describe("startWatchdog", () => {
  it("開始時に start イベントを残す(資源量つき)", async () => {
    const stop = startWatchdog(() => ({ notes: 42 }));
    await advance(0, 10);
    stop();
    await vi.advanceTimersByTimeAsync(10);

    const events = await readDiagnostics();
    const start = events.find((e) => e.kind === "start");
    expect(start).toBeDefined();
    expect(start?.metrics?.notes).toBe(42);
    expect(start?.metrics?.domNodes).toBeGreaterThan(0);
  });

  it("心拍が大きく遅れたら stall として、止まっていたミリ秒つきで残す", async () => {
    const stop = startWatchdog();
    await advance(1000); // 正常な1拍
    // 主スレッドが5秒止まった: 仮想時計は5000進むが、心拍は1回しか回らない。
    perfNow += 5000;
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    await vi.advanceTimersByTimeAsync(10);

    const stalls = (await readDiagnostics()).filter((e) => e.kind === "stall");
    expect(stalls).toHaveLength(1);
    // 遅れ = 経過(6000) - 心拍間隔(1000)
    expect(Number(stalls[0].metrics?.stallMs)).toBeGreaterThanOrEqual(4000);
    expect(stalls[0].detail).toContain("止まっていた");
  });

  it("軽い遅れ(閾値未満)では stall を残さない(ノイズを増やさない)", async () => {
    const stop = startWatchdog();
    await advance(1000);
    perfNow += 1500; // 遅れ1500ms < 閾値2000ms
    await vi.advanceTimersByTimeAsync(1000);
    stop();
    await vi.advanceTimersByTimeAsync(10);

    expect((await readDiagnostics()).filter((e) => e.kind === "stall")).toHaveLength(0);
  });

  it("60秒ごとに定期サンプルを残す", async () => {
    const stop = startWatchdog(() => ({ notes: 7 }));
    for (let i = 0; i < 61; i++) await advance(1000);
    stop();
    await vi.advanceTimersByTimeAsync(10);

    const samples = (await readDiagnostics()).filter((e) => e.kind === "sample");
    expect(samples.length).toBeGreaterThanOrEqual(1);
    expect(samples[0].metrics?.notes).toBe(7);
  });

  it("上限を超えたら古いものから捨てる(保存が無限に膨らまない)", async () => {
    const old: DiagEvent[] = Array.from({ length: DIAG_LOG_MAX }, (_, i) => ({
      at: i,
      tab: "old",
      kind: "sample",
      detail: `古い${i}`,
    }));
    await saveDiagnosticsLog(old);

    const stop = startWatchdog();
    await advance(0, 10);
    stop();
    await vi.advanceTimersByTimeAsync(10);

    const events = await readDiagnostics();
    expect(events).toHaveLength(DIAG_LOG_MAX);
    expect(events.at(-1)?.kind).toBe("start"); // 新しいものが末尾に残る
    expect(events[0].detail).not.toBe("古い0"); // 先頭の古いものが押し出されている
  });

  it("二重に開始しない(タブ内で心拍が二重に走らない)", async () => {
    const stop = startWatchdog();
    const stopSecond = startWatchdog(); // 無視される
    await advance(0, 10);
    stopSecond();
    stop();
    await vi.advanceTimersByTimeAsync(10);

    expect((await readDiagnostics()).filter((e) => e.kind === "start")).toHaveLength(1);
  });

  it("ノート本文は記録しない(数値と真偽値だけ — 秘匿・AGENTS.md §7)", async () => {
    const stop = startWatchdog(() => ({ notes: 3, wrapLines: true }));
    await advance(0, 10);
    stop();
    await vi.advanceTimersByTimeAsync(10);

    const start = (await readDiagnostics()).find((e) => e.kind === "start");
    for (const value of Object.values(start?.metrics ?? {})) {
      expect(typeof value === "number" || typeof value === "boolean").toBe(true);
    }
  });
});

describe("遅い操作・失敗の取り込み(logOpの単一出口から)", () => {
  it("閾値以上かかった操作は slowop として残る(固まる直前に何が遅かったか)", async () => {
    const stop = startWatchdog();
    logOp("db", "put", "snapshots/xyz", { elapsedMs: SLOW_OP_MS + 10 });
    await advance(0, 10);
    stop();
    await vi.advanceTimersByTimeAsync(10);

    const slow = (await readDiagnostics()).filter((e) => e.kind === "slowop");
    expect(slow).toHaveLength(1);
    expect(slow[0].detail).toContain("db/put");
    expect(slow[0].metrics?.elapsedMs).toBe(SLOW_OP_MS + 10);
  });

  it("速い操作は残さない(平常時のログで診断ログを埋めない)", async () => {
    const stop = startWatchdog();
    logOp("storage", "load", "chrome.storage.local", { elapsedMs: 10 });
    await advance(0, 10);
    stop();
    await vi.advanceTimersByTimeAsync(10);

    expect((await readDiagnostics()).filter((e) => e.kind === "slowop")).toHaveLength(0);
  });

  it("失敗は速さに関係なく残す", async () => {
    const stop = startWatchdog();
    logOp("drive", "sync", "失敗した", { error: new Error("boom") });
    await advance(0, 10);
    stop();
    await vi.advanceTimersByTimeAsync(10);

    const errors = (await readDiagnostics()).filter((e) => e.kind === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].detail).toContain("boom");
  });

  it("停止後は転送しない(解除される)", async () => {
    const stop = startWatchdog();
    await advance(0, 10);
    stop();
    await vi.advanceTimersByTimeAsync(10);
    const before = (await readDiagnostics()).length;

    logOp("db", "put", "停止後", { elapsedMs: SLOW_OP_MS + 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect((await readDiagnostics()).length).toBe(before);
  });
});

describe("formatDiagnosticsLog", () => {
  it("空なら案内を返す", () => {
    expect(formatDiagnosticsLog([])).toBe("診断ログはまだありません");
  });

  it("1行1イベントで、時刻・タブ・種別・数値を並べる", () => {
    const text = formatDiagnosticsLog([
      {
        at: Date.parse("2026-07-26T01:02:03Z"),
        tab: "ab12",
        kind: "stall",
        detail: "止まった",
        metrics: { stallMs: 5000 },
      },
    ]);
    expect(text).toBe("2026-07-26 01:02:03 [ab12] stall: 止まった stallMs=5000");
  });
});

describe("summarizeDiagnostics", () => {
  it("停止回数・最長・例外件数・タブ数をまとめる", () => {
    const summary = summarizeDiagnostics([
      { at: 1, tab: "a", kind: "stall", detail: "", metrics: { stallMs: 3000 } },
      { at: 2, tab: "a", kind: "stall", detail: "", metrics: { stallMs: 9000 } },
      { at: 3, tab: "b", kind: "error", detail: "" },
    ]);
    expect(summary).toContain("停止2回");
    expect(summary).toContain("最長9.0秒");
    expect(summary).toContain("例外1件");
    expect(summary).toContain("タブ2個分");
  });

  it("イベントが無くても壊れない", () => {
    expect(summarizeDiagnostics([])).toContain("停止0回");
  });
});
