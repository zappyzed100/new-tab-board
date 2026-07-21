// useDriveSync.test.ts — ペイン側Drive同期hook(自動周期はbackgroundへ集約)の単体テスト
// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const syncNoteToDrive = vi.fn();
vi.mock("./driveSync", () => ({
  syncNoteToDrive: (...args: unknown[]) => syncNoteToDrive(...args),
  ACTIVE_FOLDER_PATH: ["app", "New Tab Board", "active"],
}));

import type { Note } from "../../types";
import { useDriveSync } from "./useDriveSync";

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
  syncNoteToDrive.mockReset();
  syncNoteToDrive.mockResolvedValue({
    status: "synced",
    driveFileId: "file-1",
    lastSyncedAt: 1,
  });
});

describe("useDriveSync", () => {
  it("マウントや編集だけでは通信しない(5分周期はbackgroundの1本)", () => {
    const { rerender } = renderHook(({ n }) => useDriveSync(n, () => {}), {
      initialProps: { n: note() },
    });
    rerender({ n: note({ content: "編集後", tags: ["仕事"] }) });
    expect(syncNoteToDrive).not.toHaveBeenCalled();
  });

  it("明示同期では最新ノートを即時アップロードする", async () => {
    const onSynced = vi.fn();
    const { result, rerender } = renderHook(({ n }) => useDriveSync(n, onSynced), {
      initialProps: { n: note() },
    });
    rerender({ n: note({ content: "最新本文", tags: ["設計"] }) });

    act(() => result.current.syncNow(false));
    await waitFor(() => expect(syncNoteToDrive).toHaveBeenCalledTimes(1));
    expect(syncNoteToDrive.mock.calls[0][0]).toEqual(
      expect.objectContaining({ content: "最新本文", tags: ["設計"] }),
    );
    expect(onSynced).toHaveBeenCalledWith("file-1", 1);
  });

  it("background同期のlastSyncedAtが反映されたら同期済表示にする", () => {
    const { result, rerender } = renderHook(({ n }) => useDriveSync(n, () => {}), {
      initialProps: { n: note() },
    });
    rerender({ n: note({ lastSyncedAt: 100 }) });
    expect(result.current.status).toBe("synced");
  });
});
