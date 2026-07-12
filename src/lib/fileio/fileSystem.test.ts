// fileSystem.test.ts — fileSystem.ts(ローカルファイル読み込み/書き出し)の単体テスト
// <input type="file">・chrome.downloadsをvi.stubGlobalでフェイクに差し替える
// (vitestの既定環境はnodeでdocument/chromeが無いため、テスト内で丸ごと生やす)。
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportNotesToFolder, pickAndReadTextFile } from "./fileSystem";
import type { Note } from "../../types";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Listener = () => void;

/** <input type="file">の最小限のフェイク。click()で"change"または"cancel"を発火する。 */
function fakeFileInput(file: { name: string; text: () => Promise<string> } | null) {
  const listeners: Partial<Record<string, Listener[]>> = {};
  return {
    type: "",
    accept: "",
    files: file ? [file] : null,
    addEventListener(type: string, cb: Listener) {
      (listeners[type] ??= []).push(cb);
    },
    click() {
      const type = file ? "change" : "cancel";
      listeners[type]?.forEach((cb) => cb());
    },
  };
}

describe("pickAndReadTextFile", () => {
  it("選択したファイルの名前と中身を返す", async () => {
    const fakeFile = { name: "メモ.txt", text: async () => "こんにちは" };
    vi.stubGlobal("document", { createElement: () => fakeFileInput(fakeFile) });

    expect(await pickAndReadTextFile()).toEqual({ name: "メモ.txt", content: "こんにちは" });
  });

  it("キャンセルするとnullを返す", async () => {
    vi.stubGlobal("document", { createElement: () => fakeFileInput(null) });

    expect(await pickAndReadTextFile()).toBeNull();
  });
});

describe("exportNotesToFolder", () => {
  const notes: Note[] = [
    { id: "n1", title: "会議メモ", content: "本文1", pinned: false, order: 0 },
    { id: "n2", title: "TODO/リスト", content: "本文2", pinned: false, order: 1 },
  ];

  function fakeChromeDownloads(onDownload: (filename: string) => void) {
    let nextId = 1;
    const changedListeners: Array<(delta: { id: number; state?: { current: string } }) => void> =
      [];
    return {
      downloads: {
        download(opts: { filename: string }, callback: (id: number | undefined) => void) {
          const id = nextId++;
          onDownload(opts.filename);
          callback(id);
          queueMicrotask(() => {
            changedListeners.forEach((cb) => cb({ id, state: { current: "complete" } }));
          });
        },
        onChanged: {
          addListener: (cb: (delta: { id: number; state?: { current: string } }) => void) =>
            changedListeners.push(cb),
          removeListener: (cb: (delta: { id: number; state?: { current: string } }) => void) => {
            const i = changedListeners.indexOf(cb);
            if (i >= 0) changedListeners.splice(i, 1);
          },
        },
      },
      runtime: { lastError: undefined },
    };
  }

  it("各ノートを個別の.mdファイルとしてnew-tab-board-notes/へ書き出す(ファイル名は禁則文字を置換)", async () => {
    const filenames: string[] = [];
    vi.stubGlobal(
      "chrome",
      fakeChromeDownloads((f) => filenames.push(f)),
    );
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:fake",
      revokeObjectURL: () => {},
    });

    await exportNotesToFolder(notes);

    expect(filenames).toEqual([
      "new-tab-board-notes/会議メモ.md",
      "new-tab-board-notes/TODO_リスト.md", // "/"は禁則文字なので"_"に置換
    ]);
  });

  it("ダウンロードが中断(interrupted)されたら例外を投げる", async () => {
    let onChangedCb: ((delta: { id: number; state?: { current: string } }) => void) | undefined;
    vi.stubGlobal("chrome", {
      downloads: {
        download: (_opts: unknown, callback: (id: number | undefined) => void) => {
          callback(1);
          queueMicrotask(() => onChangedCb?.({ id: 1, state: { current: "interrupted" } }));
        },
        onChanged: {
          addListener: (cb: typeof onChangedCb) => {
            onChangedCb = cb;
          },
          removeListener: () => {},
        },
      },
      runtime: { lastError: undefined },
    });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} });

    await expect(exportNotesToFolder(notes)).rejects.toThrow("interrupted");
  });
});
