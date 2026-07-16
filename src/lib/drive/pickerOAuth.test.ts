// pickerOAuth.test.ts — pickerOAuth.ts(Picker「デスクトップ・モバイル向けフロー」PKCE実装)の単体テスト
import { describe, expect, it, vi } from "vitest";
import { pickSharedFolderViaOAuth } from "./pickerOAuth";

const REDIRECT_BASE = "https://ext-id.chromiumapp.org/drive-picker";

function fakeFetch(tokenOk: boolean, folderName: string | null): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      if (!tokenOk) return { ok: false, status: 400 } as Response;
      return { ok: true, json: async () => ({ access_token: "tok-abc" }) } as Response;
    }
    return {
      ok: folderName !== null,
      json: async () => (folderName !== null ? { name: folderName } : {}),
    } as Response;
  }) as unknown as typeof fetch;
}

describe("pickSharedFolderViaOAuth", () => {
  it("選択→コード交換→フォルダ名取得までできれば{id,name}を返す", async () => {
    const redirectUrl = `${REDIRECT_BASE}?code=auth-code-1&picked_file_ids=folder-1,folder-2`;
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(redirectUrl),
      getRedirectURL: () => REDIRECT_BASE,
      fetchImpl: fakeFetch(true, "共有フォルダ"),
    });
    expect(result).toEqual({ id: "folder-1", name: "共有フォルダ" });
  });

  it("リダイレクトが無ければ(ポップアップを閉じた等)nullを返す", async () => {
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(undefined),
      getRedirectURL: () => REDIRECT_BASE,
    });
    expect(result).toBeNull();
  });

  it("リダイレクトにerrorが含まれればnullを返す", async () => {
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(`${REDIRECT_BASE}?error=access_denied`),
      getRedirectURL: () => REDIRECT_BASE,
    });
    expect(result).toBeNull();
  });

  it("codeもpicked_file_idsも無ければnullを返す", async () => {
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(REDIRECT_BASE),
      getRedirectURL: () => REDIRECT_BASE,
    });
    expect(result).toBeNull();
  });

  it("トークン交換に失敗すればnullを返す", async () => {
    const redirectUrl = `${REDIRECT_BASE}?code=auth-code-1&picked_file_ids=folder-1`;
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(redirectUrl),
      getRedirectURL: () => REDIRECT_BASE,
      fetchImpl: fakeFetch(false, null),
    });
    expect(result).toBeNull();
  });

  it("フォルダ名取得に失敗してもidは返す(nameはnull)", async () => {
    const redirectUrl = `${REDIRECT_BASE}?code=auth-code-1&picked_file_ids=folder-1`;
    const result = await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(redirectUrl),
      getRedirectURL: () => REDIRECT_BASE,
      fetchImpl: fakeFetch(true, null),
    });
    expect(result).toEqual({ id: "folder-1", name: null });
  });

  it("認可URLにPKCE・drive.fileスコープ単体・trigger_onepick等の必須パラメータを含める", async () => {
    const launch = vi.fn().mockResolvedValue(undefined);
    await pickSharedFolderViaOAuth({
      launchWebAuthFlow: launch,
      getRedirectURL: () => REDIRECT_BASE,
    });
    const arg = launch.mock.calls[0][0] as { url: string; interactive: boolean };
    const url = new URL(arg.url);
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("trigger_onepick")).toBe("true");
    expect(url.searchParams.get("allow_folder_selection")).toBe("true");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_BASE);
    expect(arg.interactive).toBe(true);
  });

  it("トークン交換リクエストにclient_secretを含めない", async () => {
    const redirectUrl = `${REDIRECT_BASE}?code=auth-code-1&picked_file_ids=folder-1`;
    const fetchImpl = fakeFetch(true, "x");
    await pickSharedFolderViaOAuth({
      launchWebAuthFlow: vi.fn().mockResolvedValue(redirectUrl),
      getRedirectURL: () => REDIRECT_BASE,
      fetchImpl,
    });
    const tokenCall = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes("oauth2.googleapis.com/token"),
    );
    const body = tokenCall?.[1]?.body as string;
    expect(body).not.toContain("client_secret");
    expect(body).toContain("code_verifier");
    expect(body).toContain("grant_type=authorization_code");
  });
});
