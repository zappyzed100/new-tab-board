// useSignatureDebouncedEffect.test.ts — 署名デバウンスeffectの単体テスト
// 実時間を待たずvi.useFakeTimersで進める(テスト内sleepは禁止 — AGENTS.md §8)。
// Reactフックの実行にはDOMが要るため、このファイルだけjsdom環境で走らせる
// (既定のnode環境のままだとrenderHookがdocument未定義で落ちる)。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSignatureDebouncedEffect } from "./useSignatureDebouncedEffect";

const DELAY = 5000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSignatureDebouncedEffect", () => {
  it("署名が変わってからdelayMs後にコールバックを呼ぶ", () => {
    const onFire = vi.fn();
    renderHook(({ sig }) => useSignatureDebouncedEffect(sig, DELAY, onFire), {
      initialProps: { sig: "a" as string | null },
    });
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DELAY);
    expect(onFire).toHaveBeenCalledWith("a");
  });

  it("回帰: 署名が同じまま再レンダーされても保留中の発火が取り消されない", () => {
    // これが実害の型。依存をnotesにしていた頃は、集合が変わらない更新(本文入力・
    // driveFileIdの書き戻し等)でクリーンアップが走ってタイマーを消し、早期returnで
    // 張り直さないため、Driveの突合が永久に流れていた(2026-07-20)。
    const onFire = vi.fn();
    const { rerender } = renderHook(({ sig }) => useSignatureDebouncedEffect(sig, DELAY, onFire), {
      initialProps: { sig: "a" as string | null },
    });
    vi.advanceTimersByTime(DELAY - 1000);
    rerender({ sig: "a" }); // 署名は不変のまま再レンダー
    rerender({ sig: "a" });
    vi.advanceTimersByTime(1000);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith("a");
  });

  it("回帰: コールバックの同一性が毎レンダー変わっても発火する", () => {
    // onFireを依存に入れると、親の再レンダーが続く限りタイマーが張り直されて
    // 永久に発火しない——同じ型のもう一つの罠。
    const calls: string[] = [];
    const { rerender } = renderHook(
      ({ sig }) =>
        useSignatureDebouncedEffect(sig, DELAY, (s) => {
          calls.push(s);
        }),
      { initialProps: { sig: "a" as string | null } },
    );
    vi.advanceTimersByTime(DELAY - 1000);
    rerender({ sig: "a" }); // 新しい関数インスタンスが毎回渡る
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(["a"]);
  });

  it("delayMs中に署名が変われば待ち直し、最後の署名で1回だけ呼ぶ", () => {
    const onFire = vi.fn();
    const { rerender } = renderHook(({ sig }) => useSignatureDebouncedEffect(sig, DELAY, onFire), {
      initialProps: { sig: "a" as string | null },
    });
    vi.advanceTimersByTime(DELAY - 1000);
    rerender({ sig: "b" });
    vi.advanceTimersByTime(DELAY - 1000);
    expect(onFire).not.toHaveBeenCalled(); // aの分は取り消された
    vi.advanceTimersByTime(1000);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(onFire).toHaveBeenCalledWith("b");
  });

  it("署名がnullの間は何もしない(データ未ロード)", () => {
    const onFire = vi.fn();
    renderHook(({ sig }) => useSignatureDebouncedEffect(sig, DELAY, onFire), {
      initialProps: { sig: null as string | null },
    });
    vi.advanceTimersByTime(DELAY * 2);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("アンマウントで保留中の発火を取り消す", () => {
    const onFire = vi.fn();
    const { unmount } = renderHook(({ sig }) => useSignatureDebouncedEffect(sig, DELAY, onFire), {
      initialProps: { sig: "a" as string | null },
    });
    vi.advanceTimersByTime(DELAY - 1000);
    unmount();
    vi.advanceTimersByTime(DELAY);
    expect(onFire).not.toHaveBeenCalled();
  });
});
