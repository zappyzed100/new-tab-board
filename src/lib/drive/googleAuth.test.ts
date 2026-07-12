// googleAuth.test.ts — googleAuth.ts(launchWebAuthFlowラッパー)の単体テスト
// モジュールがトークンをモジュール内状態でキャッシュするため、テストごとに
// vi.resetModules()＋動的importで新しいモジュールインスタンスを読み直して隔離する
// (キャッシュのテスト間漏れを防ぐ——src/lib/externalIO/CLAUDE.mdの「モジュール状態は
// テスト間で永続する」の型と同じ)。
import { afterEach, describe, expect, it, vi } from "vitest";

type LaunchFn = ReturnType<typeof vi.fn>;

/** chromeスタブを組んでgoogleAuthを新規に読み込む。launchWebAuthFlowはテスト側で差し替える。 */
async function load(launchWebAuthFlow: LaunchFn) {
  vi.resetModules();
  vi.stubGlobal("chrome", {
    runtime: {
      getManifest: () => ({
        oauth2: {
          client_id: "test-client-id",
          scopes: ["https://scope-a", "https://scope-b"],
        },
      }),
    },
    identity: {
      getRedirectURL: () => "https://ext-id.chromiumapp.org/",
      launchWebAuthFlow,
    },
  });
  return await import("./googleAuth");
}

/** access_token付きのリダイレクトURL(implicitフローの戻り)を作る。 */
function redirectWith(token: string, expiresIn = 3600): string {
  return `https://ext-id.chromiumapp.org/#access_token=${token}&expires_in=${expiresIn}&token_type=Bearer`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAuthToken", () => {
  it("launchWebAuthFlowが返すリダイレクトからaccess_tokenを取り出して返す", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    expect(await getAuthToken(true)).toBe("abc123");
  });

  it("getAuthTokenではなくlaunchWebAuthFlowを、implicitフローのURLで呼ぶ(カスタムURIスキーム回避)", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    await getAuthToken(true);
    expect(launch).toHaveBeenCalledTimes(1);
    const arg = launch.mock.calls[0][0] as { url: string; interactive: boolean };
    expect(arg.interactive).toBe(true);
    const url = new URL(arg.url);
    expect(url.searchParams.get("response_type")).toBe("token");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://ext-id.chromiumapp.org/");
    expect(url.searchParams.get("scope")).toBe("https://scope-a https://scope-b");
  });

  it("リダイレクトにaccess_tokenが無ければnullを返す", async () => {
    const launch = vi.fn().mockResolvedValue("https://ext-id.chromiumapp.org/#error=access_denied");
    const { getAuthToken } = await load(launch);
    expect(await getAuthToken(false)).toBeNull();
  });

  it("例外が投げられても握りつぶしてnullを返す(未サインイン等)", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("The user is not signed in."));
    const { getAuthToken } = await load(launch);
    expect(await getAuthToken(false)).toBeNull();
  });

  it("有効期限内の2回目はlaunchWebAuthFlowを再度呼ばずキャッシュを返す", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123", 3600));
    const { getAuthToken } = await load(launch);
    expect(await getAuthToken(true)).toBe("abc123");
    expect(await getAuthToken(false)).toBe("abc123");
    expect(launch).toHaveBeenCalledTimes(1);
  });
});

describe("getAuthTokenWithError", () => {
  it("取得成功時はtokenを返しerrorはnull", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthTokenWithError } = await load(launch);
    expect(await getAuthTokenWithError(true)).toEqual({ token: "abc123", error: null });
  });

  it("例外時は握りつぶさずerrorにメッセージを返す", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("popup closed by user"));
    const { getAuthTokenWithError } = await load(launch);
    expect(await getAuthTokenWithError(true)).toEqual({
      token: null,
      error: "popup closed by user",
    });
  });

  it("access_tokenが無ければtoken:nullとerrorメッセージを返す", async () => {
    const launch = vi.fn().mockResolvedValue("https://ext-id.chromiumapp.org/#error=access_denied");
    const { getAuthTokenWithError } = await load(launch);
    const result = await getAuthTokenWithError(false);
    expect(result.token).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe("invalidateToken", () => {
  it("キャッシュを破棄し、次回はlaunchWebAuthFlowを再度呼ぶ", async () => {
    const launch = vi
      .fn()
      .mockResolvedValueOnce(redirectWith("first"))
      .mockResolvedValueOnce(redirectWith("second"));
    const { getAuthToken, invalidateToken } = await load(launch);
    expect(await getAuthToken(true)).toBe("first");
    await invalidateToken("first");
    expect(await getAuthToken(true)).toBe("second");
    expect(launch).toHaveBeenCalledTimes(2);
  });
});
