// fileSystem.test.ts — fileSystem.ts(File System Access APIラッパー)の単体テスト
// window.showOpenFilePicker/showDirectoryPickerをvi.stubGlobalでフェイクに差し替える
// (vitestの既定環境はnodeでwindowが無いため、テスト内で丸ごと生やす)。
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportNotesToFolder, pickAndReadTextFile } from "./fileSystem";
import type { Note } from "../types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function abortError(): DOMException {
  return new DOMException("The user aborted a request.", "AbortError");
}

describe("pickAndReadTextFile", () => {
  it("選択したファイルの名前と中身を返す", async () => {
    const fakeFile = { name: "メモ.txt", text: async () => "こんにちは" };
    const fakeHandle = { getFile: async () => fakeFile };
    vi.stubGlobal("window", { showOpenFilePicker: async () => [fakeHandle] });

    expect(await pickAndReadTextFile()).toEqual({ name: "メモ.txt", content: "こんにちは" });
  });

  it("キャンセル(AbortError)ならnullを返す", async () => {
    vi.stubGlobal("window", {
      showOpenFilePicker: async () => {
        throw abortError();
      },
    });
    expect(await pickAndReadTextFile()).toBeNull();
  });

  it("AbortError以外の例外は再送出する", async () => {
    vi.stubGlobal("window", {
      showOpenFilePicker: async () => {
        throw new Error("permission denied");
      },
    });
    await expect(pickAndReadTextFile()).rejects.toThrow("permission denied");
  });
});

describe("exportNotesToFolder", () => {
  const notes: Note[] = [
    { id: "n1", title: "会議メモ", content: "本文1", pinned: false, order: 0 },
    { id: "n2", title: "TODO/リスト", content: "本文2", pinned: false, order: 1 },
  ];

  it("各ノートを個別の.mdファイルとして書き出す(ファイル名は禁則文字を置換)", async () => {
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

    await exportNotesToFolder(notes);

    expect(written.get("会議メモ.md")).toBe("本文1");
    expect(written.get("TODO_リスト.md")).toBe("本文2"); // "/"は禁則文字なので"_"に置換
  });

  it("キャンセル(AbortError)なら何も書き出さず正常終了する", async () => {
    vi.stubGlobal("window", {
      showDirectoryPicker: async () => {
        throw abortError();
      },
    });
    await expect(exportNotesToFolder(notes)).resolves.toBeUndefined();
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
