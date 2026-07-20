// pickerOAuth.test.ts — pickerOAuth.ts(Picker「デスクトップ・モバイル向けフロー」実装)の単体テスト
import { describe, expect, it, vi } from "vitest";
import { pickSharedFolderViaOAuth } from "./pickerOAuth";

const REDIRECT_BASE = "https://ext-id.chromiumapp.org/";

function fakeFetch(folderName: string | null): typeof fetch {
  return vi.fn(async () => {
    return {
      ok: folderName !== null,
      json: async () => (folderName !== null ? { name: folderName } : {}),
    } as Response;
  }) as unknown as typeof fetch;
}

describe("pickSharedFolderViaOAuth", () => {
  it("フラグメントでaccess_token・picked_file_idsが返れば{id,name}を返す", async () => {
    const redirectUrl = `${REDIRECT_BASE}#access_token=tok-abc&picked_file_ids=folder-1,folder-2`;
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(redirectUrl),
      getRedirectURL: () => REDIRECT_BASE,
      getClientId: () => "client-abc",
      fetchImpl: fakeFetch("共有フォルダ"),
    });
    expect(result).toEqual({ id: "folder-1", name: "共有フォルダ" });
  });

  it("クエリ文字列で返っても解釈できる", async () => {
    const redirectUrl = `${REDIRECT_BASE}?access_token=tok-abc&picked_file_ids=folder-1`;
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(redirectUrl),
      getRedirectURL: () => REDIRECT_BASE,
      getClientId: () => "client-abc",
      fetchImpl: fakeFetch("共有フォルダ"),
    });
    expect(result).toEqual({ id: "folder-1", name: "共有フォルダ" });
  });

  it("リダイレクトが無ければ(ポップアップを閉じた等)nullを返す", async () => {
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(undefined),
      getRedirectURL: () => REDIRECT_BASE,
      getClientId: () => "client-abc",
    });
    expect(result).toBeNull();
  });

  it("リダイレクトにerrorが含まれればnullを返す", async () => {
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(`${REDIRECT_BASE}#error=access_denied`),
      getRedirectURL: () => REDIRECT_BASE,
      getClientId: () => "client-abc",
    });
    expect(result).toBeNull();
  });

  it("access_tokenもpicked_file_idsも無ければnullを返す", async () => {
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(REDIRECT_BASE),
      getRedirectURL: () => REDIRECT_BASE,
      getClientId: () => "client-abc",
    });
    expect(result).toBeNull();
  });

  it("フォルダ名取得に失敗してもidは返す(nameはnull)", async () => {
    const redirectUrl = `${REDIRECT_BASE}#access_token=tok-abc&picked_file_ids=folder-1`;
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(redirectUrl),
      getRedirectURL: () => REDIRECT_BASE,
      getClientId: () => "client-abc",
      fetchImpl: fakeFetch(null),
    });
    expect(result).toEqual({ id: "folder-1", name: null });
  });

  it("getRedirectURLを引数無しで呼ぶ(パス付きだと別URIになりredirect_uri_mismatchになる実機不具合の回帰)", async () => {
    const getRedirectURL = vi.fn().mockReturnValue(REDIRECT_BASE);
    await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(undefined),
      getRedirectURL,
      getClientId: () => "client-abc",
    });
    expect(getRedirectURL).toHaveBeenCalledWith();
  });

  it("認可URLにresponse_type=token・drive.fileスコープ単体・trigger_onepick等の必須パラメータを含める(response_type=codeはChrome拡張機能型クライアントでredirect_uri_mismatchになった実機不具合の回帰)", async () => {
    const launch = vi.fn().mockResolvedValue(undefined);
    await pickSharedFolderViaOAuth({
      launchWebAuthFlow: launch,
      getRedirectURL: () => REDIRECT_BASE,
      getClientId: () => "client-abc",
    });
    const arg = launch.mock.calls[0][0] as { url: string; interactive: boolean };
    const url = new URL(arg.url);
    expect(url.searchParams.get("client_id")).toBe("client-abc");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("response_type")).toBe("token");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("trigger_onepick")).toBe("true");
    expect(url.searchParams.get("allow_folder_selection")).toBe("true");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_BASE);
    expect(arg.interactive).toBe(true);
  });
});
