// fileSystem.test.ts — fileSystem.ts(ローカルファイル読み込み/書き出し)の単体テスト
// <input type="file">・window.showDirectoryPickerをvi.stubGlobalでフェイクに差し替える
// (vitestの既定環境はnodeでdocument/windowが無いため、テスト内で丸ごと生やす)。
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

function abortError(): DOMException {
  return new DOMException("The user aborted a request.", "AbortError");
}

describe("exportNotesToFolder", () => {
  const notes: Note[] = [
    { id: "n1", title: "会議メモ", content: "本文1", pinned: false, order: 0 },
    { id: "n2", title: "TODO/リスト", content: "本文2", pinned: false, order: 1 },
  ];

  it("選んだフォルダへ各ノートを個別の.mdファイルとして書き出す(ファイル名は禁則文字を置換)", async () => {
    const written = new Map<string, string>();
    const fakeDir = {
      getFileHandle: async (name: string) => ({
        createWritable: async () => ({
          write: async (data: string) => written.set(name, data),
          close: async () => {},
        }),
      }),
    };
    vi.stubGlobal("window", { showDirectoryPicker: async () => fakeDir });

    await expect(exportNotesToFolder(notes)).resolves.toEqual({ exported: 2, cancelled: false });

    expect(written.get("会議メモ.md")).toBe("本文1");
    expect(written.get("TODO_リスト.md")).toBe("本文2"); // "/"は禁則文字なので"_"に置換
  });

  it("フォルダ選択をキャンセル(AbortError)すると0件で打ち切る", async () => {
    vi.stubGlobal("window", {
      showDirectoryPicker: async () => {
        throw abortError();
      },
    });

    await expect(exportNotesToFolder(notes)).resolves.toEqual({ exported: 0, cancelled: true });
  });

  it("AbortError以外の例外は再送出する", async () => {
    vi.stubGlobal("window", {
      showDirectoryPicker: async () => {
        throw new Error("permission denied");
      },
    });

    await expect(exportNotesToFolder(notes)).rejects.toThrow("permission denied");
  });
});
