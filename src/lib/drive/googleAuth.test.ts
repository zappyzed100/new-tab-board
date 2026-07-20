// googleAuth.test.ts — googleAuth.ts(chrome.identity.getAuthTokenラッパー)の単体テスト
// この層はトークンをキャッシュしない(Chromeが保持・更新する)。かつてモジュール変数で
// キャッシュしていた頃はタブごとにキャッシュが空になり、毎回の再認可要求が失敗して
// Drive連携が無症状で停止した(2026-07-18〜20の実害)——その回帰を下の
// 「新しいタブ相当」テストで固定する。モジュール状態の漏れを避けるため、テストごとに
// vi.resetModules()＋動的importで読み直す。
import { afterEach, describe, expect, it, vi } from "vitest";

type MockFn = ReturnType<typeof vi.fn>;

type IdentityStub = {
  getAuthToken?: MockFn;
  removeCachedAuthToken?: MockFn;
  launchWebAuthFlow?: MockFn;
  getRedirectURL?: () => string;
};

/** chromeスタブを組んでgoogleAuthを新規に読み込む(=新しいタブでの初回読み込み相当)。 */
async function load(identity: IdentityStub) {
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
    identity,
  });
  return await import("./googleAuth");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAuthToken", () => {
  it("chrome.identity.getAuthTokenが返すトークンを返す", async () => {
    const getToken = vi.fn().mockResolvedValue({ token: "abc123" });
    const { getAuthToken } = await load({ getAuthToken: getToken });
    expect(await getAuthToken(true)).toBe("abc123");
    expect(getToken).toHaveBeenCalledWith({ interactive: true });
  });

  it("トークン文字列を直接返すChrome実装にも対応する", async () => {
    const getToken = vi.fn().mockResolvedValue("abc123");
    const { getAuthToken } = await load({ getAuthToken: getToken });
    expect(await getAuthToken(false)).toBe("abc123");
  });

  it("launchWebAuthFlow(implicitフロー)は使わない——Chromeのトークン更新に委ねるため", async () => {
    const getToken = vi.fn().mockResolvedValue({ token: "abc123" });
    const launch = vi.fn();
    const { getAuthToken } = await load({ getAuthToken: getToken, launchWebAuthFlow: launch });
    await getAuthToken(true);
    expect(launch).not.toHaveBeenCalled();
  });

  it("回帰: 新しいタブ(モジュール再読み込み)でもinteractive=falseでトークンを取得できる", async () => {
    // 実害の再現条件そのもの。以前はモジュール変数のキャッシュが空の状態から
    // launchWebAuthFlow({interactive:false})を叩き、`User interaction required`で失敗して
    // nullになり、Driveの突合(reconcileDriveActive)が丸ごとスキップされていた。
    const getToken = vi.fn().mockResolvedValue({ token: "fresh-tab-token" });
    const first = await load({ getAuthToken: getToken });
    expect(await first.getAuthToken(false)).toBe("fresh-tab-token");

    const second = await load({ getAuthToken: getToken }); // 別タブ相当の新インスタンス
    expect(await second.getAuthToken(false)).toBe("fresh-tab-token");
  });

  it("この層はキャッシュしない(呼ぶたびchrome.identity.getAuthTokenへ委譲する)", async () => {
    const getToken = vi.fn().mockResolvedValue({ token: "abc123" });
    const { getAuthToken } = await load({ getAuthToken: getToken });
    await getAuthToken(true);
    await getAuthToken(false);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it("トークンが空なら(未許可等)nullを返す", async () => {
    const getToken = vi.fn().mockResolvedValue({});
    const { getAuthToken } = await load({ getAuthToken: getToken });
    expect(await getAuthToken(false)).toBeNull();
  });

  it("例外が投げられても握りつぶしてnullを返す(未サインイン等)", async () => {
    const getToken = vi.fn().mockRejectedValue(new Error("The user is not signed in."));
    const { getAuthToken } = await load({ getAuthToken: getToken });
    expect(await getAuthToken(false)).toBeNull();
  });
});

describe("getAuthTokenWithError", () => {
  it("取得成功時はtokenを返しerrorはnull", async () => {
    const getToken = vi.fn().mockResolvedValue({ token: "abc123" });
    const { getAuthTokenWithError } = await load({ getAuthToken: getToken });
    expect(await getAuthTokenWithError(true)).toEqual({ token: "abc123", error: null });
  });

  it("例外時は握りつぶさずerrorにメッセージを返す", async () => {
    const getToken = vi.fn().mockRejectedValue(new Error("popup closed by user"));
    const { getAuthTokenWithError } = await load({ getAuthToken: getToken });
    expect(await getAuthTokenWithError(true)).toEqual({
      token: null,
      error: "popup closed by user",
    });
  });

  it("トークンが空ならtoken:nullとerrorメッセージを返す", async () => {
    const getToken = vi.fn().mockResolvedValue({});
    const { getAuthTokenWithError } = await load({ getAuthToken: getToken });
    const result = await getAuthTokenWithError(false);
    expect(result.token).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe("invalidateToken", () => {
  it("chrome.identity.removeCachedAuthTokenへ委譲する(Chrome側のキャッシュを外す)", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { invalidateToken } = await load({
      getAuthToken: vi.fn(),
      removeCachedAuthToken: remove,
    });
    await invalidateToken("stale");
    expect(remove).toHaveBeenCalledWith({ token: "stale" });
  });

  it("除去に失敗しても例外を投げない(次回取得を妨げないため)", async () => {
    const remove = vi.fn().mockRejectedValue(new Error("not cached"));
    const { invalidateToken } = await load({
      getAuthToken: vi.fn(),
      removeCachedAuthToken: remove,
    });
    await expect(invalidateToken("stale")).resolves.toBeUndefined();
  });
});
