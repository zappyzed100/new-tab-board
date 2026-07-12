// fileSystem.test.ts — fileSystem.ts(ローカルファイル読み込み)の単体テスト
// <input type="file">をvi.stubGlobalでフェイクに差し替える
// (vitestの既定環境はnodeでdocumentが無いため、テスト内で丸ごと生やす)。
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickAndReadTextFile } from "./fileSystem";

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
