// useForegroundSync.test.ts — 前景復帰で同期をキックするhookの単体テスト
// 時刻は注入したフェイクで進める(現在時刻の直呼びは禁止 — AGENTS.md §8)。
// イベントリスナーの検証にDOMが要るためjsdom環境で走らせる。
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useForegroundSync } from "./useForegroundSync";

const MIN_INTERVAL = 30_000;

/** 手で進められる時計(clock.tsのシームの代役)。 */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

afterEach(() => {
  setVisibility("visible");
});

describe("useForegroundSync", () => {
  it("マウント直後の前景イベントは見送る(新しいタブでApp側の初回同期と二重にDriveを叩かない)", () => {
    const onForeground = vi.fn();
    const clock = fakeClock();
    renderHook(() => useForegroundSync(onForeground, MIN_INTERVAL, clock.now));
    window.dispatchEvent(new Event("focus")); // タブを開いた直後に飛ぶ
    expect(onForeground).not.toHaveBeenCalled();
  });

  it("タブが表示状態になったらコールバックを呼ぶ", () => {
    const onForeground = vi.fn();
    const clock = fakeClock();
    renderHook(() => useForegroundSync(onForeground, MIN_INTERVAL, clock.now));
    clock.advance(MIN_INTERVAL); // マウント直後の分はApp側の初回同期が担うため間隔を空ける
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it("ウィンドウfocusでも呼ぶ(別ウィンドウから戻る経路)", () => {
    const onForeground = vi.fn();
    const clock = fakeClock();
    renderHook(() => useForegroundSync(onForeground, MIN_INTERVAL, clock.now));
    clock.advance(MIN_INTERVAL);
    window.dispatchEvent(new Event("focus"));
    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it("非表示になった時は呼ばない(離れる側でDriveを叩かない)", () => {
    const onForeground = vi.fn();
    const clock = fakeClock();
    renderHook(() => useForegroundSync(onForeground, MIN_INTERVAL, clock.now));
    clock.advance(MIN_INTERVAL);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onForeground).not.toHaveBeenCalled();
  });

  it("最小間隔の内側は見送る(visibilitychangeとfocusが同時に来てもDriveを連打しない)", () => {
    const onForeground = vi.fn();
    const clock = fakeClock();
    renderHook(() => useForegroundSync(onForeground, MIN_INTERVAL, clock.now));
    clock.advance(MIN_INTERVAL);
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus")); // 同時刻——まとめて1回に落ちる
    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it("最小間隔を過ぎれば再び呼ぶ", () => {
    const onForeground = vi.fn();
    const clock = fakeClock();
    renderHook(() => useForegroundSync(onForeground, MIN_INTERVAL, clock.now));
    clock.advance(MIN_INTERVAL);
    document.dispatchEvent(new Event("visibilitychange"));
    clock.advance(MIN_INTERVAL);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onForeground).toHaveBeenCalledTimes(2);
  });

  it("回帰: コールバックの同一性が毎レンダー変わってもリスナーを張り直さず発火する", () => {
    // onForegroundを依存に入れると親の再レンダーのたびにaddEventListener/removeEventListenerを
    // やり直す。このリポジトリで繰り返し踏んでいるeffect依存の罠を構造的に防ぐ。
    const calls: number[] = [];
    const clock = fakeClock();
    const { rerender } = renderHook(
      ({ tag }) =>
        useForegroundSync(
          () => {
            calls.push(tag);
          },
          MIN_INTERVAL,
          clock.now,
        ),
      { initialProps: { tag: 1 } },
    );
    clock.advance(MIN_INTERVAL);
    rerender({ tag: 2 }); // 新しい関数インスタンスが渡る
    document.dispatchEvent(new Event("visibilitychange"));
    expect(calls).toEqual([2]); // 最新のコールバックが呼ばれる
  });

  it("アンマウントでリスナーを外す", () => {
    const onForeground = vi.fn();
    const clock = fakeClock();
    const { unmount } = renderHook(() => useForegroundSync(onForeground, MIN_INTERVAL, clock.now));
    clock.advance(MIN_INTERVAL);
    unmount();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onForeground).not.toHaveBeenCalled();
  });
});
