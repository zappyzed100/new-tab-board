// useDriveSync.test.ts — ノート編集をdebounceしてDrive同期をキックするhookの単体テスト
// 実時間を待たずvi.useFakeTimersで進める(テスト内sleepは禁止 — AGENTS.md §8)。
// Reactフックの実行にはDOMが要るためjsdom環境で走らせる。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const syncNoteToDrive = vi.fn();
vi.mock("./driveSync", () => ({
  syncNoteToDrive: (...args: unknown[]) => syncNoteToDrive(...args),
  ACTIVE_FOLDER_PATH: ["app", "New Tab Board", "active"],
}));

import { useDriveSync } from "./useDriveSync";
import type { Note } from "../../types";

const DEBOUNCE_MS = 300_000;

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "タイトル",
    content: "本文",
    pinned: false,
    order: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  syncNoteToDrive.mockReset();
  syncNoteToDrive.mockResolvedValue({
    status: "synced",
    driveFileId: "file-1",
    lastSyncedAt: 1,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDriveSync", () => {
  it("debounce経過後にアップロードする", () => {
    renderHook(({ n }) => useDriveSync(n, () => {}), { initialProps: { n: note() } });
    expect(syncNoteToDrive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(syncNoteToDrive).toHaveBeenCalledTimes(1);
  });

  it("回帰: タグだけが変わっても再同期する(本文は不変)", () => {
    // 実害の型(ユーザー報告・2026-07-20「5分たってタグが生成されてもGDriveが更新されない」)。
    // 依存が[note.content, note.id]だった頃は、Geminiの自動タグ付けがtags/titleだけを変えても
    // effectが再発火せず、本文編集のタイマーがタグ生成より先に発火したケースでは
    // タグがDriveへ永久に上がらなかった。
    const { rerender } = renderHook(({ n }) => useDriveSync(n, () => {}), {
      initialProps: { n: note() },
    });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(syncNoteToDrive).toHaveBeenCalledTimes(1);

    rerender({ n: note({ tags: ["仕事", "設計"] }) }); // 本文は同じ・タグだけ付いた
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(syncNoteToDrive).toHaveBeenCalledTimes(2);
    const uploaded = syncNoteToDrive.mock.calls[1][0] as Note;
    expect(uploaded.tags).toEqual(["仕事", "設計"]);
  });

  it("回帰: タイトルだけが変わっても再同期する(Geminiがタイトルを付ける経路)", () => {
    const { rerender } = renderHook(({ n }) => useDriveSync(n, () => {}), {
      initialProps: { n: note() },
    });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    rerender({ n: note({ title: "AIが付けたタイトル" }) });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(syncNoteToDrive).toHaveBeenCalledTimes(2);
  });

  it("保存に影響しない変化(order)では再同期しない(並べ替えで全ノートが再送されるのを避ける)", () => {
    const { rerender } = renderHook(({ n }) => useDriveSync(n, () => {}), {
      initialProps: { n: note() },
    });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(syncNoteToDrive).toHaveBeenCalledTimes(1);
    rerender({ n: note({ order: 7 }) });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(syncNoteToDrive).toHaveBeenCalledTimes(1);
  });

  it("debounce中に再度変化すれば待ち直す(最後の状態で1回だけ送る)", () => {
    const { rerender } = renderHook(({ n }) => useDriveSync(n, () => {}), {
      initialProps: { n: note() },
    });
    vi.advanceTimersByTime(DEBOUNCE_MS - 1000);
    rerender({ n: note({ content: "本文2" }) });
    vi.advanceTimersByTime(DEBOUNCE_MS - 1000);
    expect(syncNoteToDrive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(syncNoteToDrive).toHaveBeenCalledTimes(1);
  });
});
