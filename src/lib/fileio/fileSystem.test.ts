// fileSystem.test.ts — fileSystem.ts(ローカルファイル読み込み)の単体テスト
// <input type="file">をvi.stubGlobalでフェイクに差し替える
// (vitestの既定環境はnodeでdocumentが無いため、テスト内で丸ごと生やす)。
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickAndReadJsonFile, pickAndReadTextFile, saveTextFile } from "./fileSystem";

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

  it(".txtだけを選べるようacceptを絞る", async () => {
    const input = fakeFileInput({ name: "メモ.txt", text: async () => "本文" });
    stubDocumentWithInput(input);

    await pickAndReadTextFile();

    expect(input.accept).toBe(".txt,text/plain");
  });
});

describe("pickAndReadJsonFile", () => {
  it("選択したJSONの名前と中身を返し、acceptを.jsonに絞る", async () => {
    const input = fakeFileInput({ name: "settings.json", text: async () => '{"version":1}' });
    stubDocumentWithInput(input);

    expect(await pickAndReadJsonFile()).toEqual({
      name: "settings.json",
      content: '{"version":1}',
    });
    expect(input.accept).toBe(".json,application/json");
  });

  it("キャンセルするとnullを返す", async () => {
    stubDocumentWithInput(fakeFileInput(null));

    expect(await pickAndReadJsonFile()).toBeNull();
  });
});

describe("saveTextFile", () => {
  /** <a download>とURL.createObjectURLの最小限のフェイク。実装がbodyへ一時接続してから
   * click()する流儀なので、appendChild/remove()も観測できるようにする。 */
  function stubDownloadAnchor() {
    const anchor = {
      href: "",
      download: "",
      style: {} as Record<string, string>,
      clicked: 0,
      removed: 0,
      click() {
        this.clicked++;
      },
      remove() {
        this.removed++;
      },
    };
    const appended: unknown[] = [];
    vi.stubGlobal("document", {
      createElement: () => anchor,
      body: {
        appendChild: (el: unknown) => {
          appended.push(el);
        },
      },
    });
    const revoked: string[] = [];
    const blobs: { content: unknown[]; type: string }[] = [];
    vi.stubGlobal(
      "Blob",
      class {
        constructor(content: unknown[], options: { type: string }) {
          blobs.push({ content, type: options.type });
        }
      },
    );
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:fake-url",
      revokeObjectURL: (url: string) => revoked.push(url),
    });
    return { anchor, appended, revoked, blobs };
  }

  it("指定のファイル名・MIMEでダウンロードを起動する", () => {
    const { anchor, appended, blobs } = stubDownloadAnchor();

    saveTextFile("settings.json", '{"a":1}', "application/json");

    expect(anchor.download).toBe("settings.json");
    expect(anchor.href).toBe("blob:fake-url");
    expect(anchor.clicked).toBe(1);
    expect(appended).toEqual([anchor]);
    expect(blobs).toEqual([{ content: ['{"a":1}'], type: "application/json" }]);
  });

  it("生成したObjectURLを解放し、一時的な<a>をDOMから取り除く", () => {
    const { anchor, revoked } = stubDownloadAnchor();

    saveTextFile("settings.json", "{}", "application/json");

    // 解放し損ねるとBlobがページ生存中ずっとメモリに残る。
    expect(revoked).toEqual(["blob:fake-url"]);
    expect(anchor.removed).toBe(1);
  });
});
