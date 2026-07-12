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

/** <input type="file">の最小限のフェイク。click()で"change"または"cancel"を発火する。
 * 実装がDOMへ一時的に接続するため(ネイティブダイアログを確実に開くための対策)、
 * style/remove()も併せて生やす。 */
function fakeFileInput(file: { name: string; text: () => Promise<string> } | null) {
  const listeners: Partial<Record<string, Listener[]>> = {};
  return {
    type: "",
    accept: "",
    style: {} as Record<string, string>,
    files: file ? [file] : null,
    addEventListener(type: string, cb: Listener) {
      (listeners[type] ??= []).push(cb);
    },
    remove() {},
    click() {
      const type = file ? "change" : "cancel";
      listeners[type]?.forEach((cb) => cb());
    },
  };
}

function stubDocumentWithInput(input: ReturnType<typeof fakeFileInput>) {
  vi.stubGlobal("document", {
    createElement: () => input,
    body: { appendChild: () => {} },
  });
}

describe("pickAndReadTextFile", () => {
  it("選択したファイルの名前と中身を返す", async () => {
    const fakeFile = { name: "メモ.txt", text: async () => "こんにちは" };
    stubDocumentWithInput(fakeFileInput(fakeFile));

    expect(await pickAndReadTextFile()).toEqual({ name: "メモ.txt", content: "こんにちは" });
  });

  it("キャンセルするとnullを返す", async () => {
    stubDocumentWithInput(fakeFileInput(null));

    expect(await pickAndReadTextFile()).toBeNull();
  });
});

describe("exportNotesToFolder", () => {
  const notes: Note[] = [
    { id: "n1", title: "会議メモ", content: "本文1", pinned: false, order: 0 },
    { id: "n2", title: "TODO/リスト", content: "本文2", pinned: false, order: 1 },
  ];

  type Delta = { id: number; state?: { current: string }; error?: { current: string } };

  function fakeChromeDownloads(
    onDownload: (filename: string) => void,
    outcomeOf: (filename: string) => "complete" | "interrupted" | "cancelled",
  ) {
    let nextId = 1;
    const changedListeners: Array<(delta: Delta) => void> = [];
    return {
      downloads: {
        download(opts: { filename: string }, callback: (id: number | undefined) => void) {
          const id = nextId++;
          onDownload(opts.filename);
          const outcome = outcomeOf(opts.filename);
          callback(id);
          queueMicrotask(() => {
            if (outcome === "complete") {
              changedListeners.forEach((cb) => cb({ id, state: { current: "complete" } }));
            } else if (outcome === "interrupted") {
              changedListeners.forEach((cb) => cb({ id, state: { current: "interrupted" } }));
            } else {
              changedListeners.forEach((cb) =>
                cb({ id, state: { current: "interrupted" }, error: { current: "USER_CANCELED" } }),
              );
            }
          });
        },
        onChanged: {
          addListener: (cb: (delta: Delta) => void) => changedListeners.push(cb),
          removeListener: (cb: (delta: Delta) => void) => {
            const i = changedListeners.indexOf(cb);
            if (i >= 0) changedListeners.splice(i, 1);
          },
        },
      },
      runtime: { lastError: undefined },
    };
  }

  it("各ノートを個別の.mdファイルとして書き出す(ファイル名は禁則文字を置換)", async () => {
    const filenames: string[] = [];
    vi.stubGlobal(
      "chrome",
      fakeChromeDownloads(
        (f) => filenames.push(f),
        () => "complete",
      ),
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} });

    await expect(exportNotesToFolder(notes)).resolves.toEqual({ exported: 2, cancelled: false });

    expect(filenames).toEqual([
      "会議メモ.md",
      "TODO_リスト.md", // "/"は禁則文字なので"_"に置換
    ]);
  });

  it("保存先ダイアログをキャンセルすると、そこまでの件数で打ち切る", async () => {
    vi.stubGlobal(
      "chrome",
      fakeChromeDownloads(
        () => {},
        (filename) => (filename === "会議メモ.md" ? "complete" : "cancelled"),
      ),
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} });

    await expect(exportNotesToFolder(notes)).resolves.toEqual({ exported: 1, cancelled: true });
  });

  it("ダウンロードが中断(interrupted・キャンセル以外)されたら例外を投げる", async () => {
    vi.stubGlobal(
      "chrome",
      fakeChromeDownloads(
        () => {},
        () => "interrupted",
      ),
    );
    vi.stubGlobal("URL", { createObjectURL: () => "blob:fake", revokeObjectURL: () => {} });

    await expect(exportNotesToFolder(notes)).rejects.toThrow("interrupted");
  });
});
