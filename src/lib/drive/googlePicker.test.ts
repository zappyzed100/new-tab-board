// googlePicker.test.ts — googlePicker.ts(Google Picker APIラッパー)の単体テスト
// 実際のgapi/google.pickerはjsdomに存在しないため、getGooglePickerをDIで差し替えて
// コールバック配線(選択/キャンセル)のみを検証する(ensurePickerLoadedのスクリプト注入
// 経路自体はgoogleAuth.ts同様、実ブラウザ依存として単体テスト対象外)。
import { describe, expect, it, vi } from "vitest";
import { pickSharedFolder } from "./googlePicker";

type CallbackData = { action: string; docs?: { id: string; name: string }[] };

function fakePickerNamespace(result: CallbackData) {
  let capturedCallback: ((data: CallbackData) => void) | undefined;
  class FakeDocsView {
    setIncludeFolders() {
      return this;
    }
    setSelectFolderEnabled() {
      return this;
    }
    setMimeTypes() {
      return this;
    }
  }
  class FakePickerBuilder {
    addView() {
      return this;
    }
    setOAuthToken() {
      return this;
    }
    setDeveloperKey() {
      return this;
    }
    setCallback(cb: (data: CallbackData) => void) {
      capturedCallback = cb;
      return this;
    }
    build() {
      return {
        setVisible: () => {
          capturedCallback?.(result);
        },
      };
    }
  }
  return {
    DocsView: FakeDocsView,
    PickerBuilder: FakePickerBuilder,
    Action: { PICKED: "picked", CANCEL: "cancel" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("pickSharedFolder", () => {
  it("選択されたフォルダの{id, name}を返す", async () => {
    const picker = fakePickerNamespace({
      action: "picked",
      docs: [{ id: "folder-1", name: "app" }],
    });
    const result = await pickSharedFolder("token", "key", { getGooglePicker: () => picker });
    expect(result).toEqual({ id: "folder-1", name: "app" });
  });

  it("キャンセル時はnullを返す", async () => {
    const picker = fakePickerNamespace({ action: "cancel" });
    const result = await pickSharedFolder("token", "key", { getGooglePicker: () => picker });
    expect(result).toBeNull();
  });

  it("gapiもgoogle.pickerも読み込めなければ例外を投げる", async () => {
    await expect(
      pickSharedFolder("token", "key", {
        getGapi: () => undefined,
        getGooglePicker: () => undefined,
        loadScript: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow("gapiの読み込みに失敗しました");
  });
});
