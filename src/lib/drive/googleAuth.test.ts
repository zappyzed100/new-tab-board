// googleAuth.test.ts — googleAuth.ts(launchWebAuthFlowラッパー)の単体テスト
// このモジュールはトークンをメモリ+chrome.storage.localの2層でキャッシュするため、
// テストごとにvi.resetModules()＋動的importで新しいモジュールインスタンスを読み直して
// 隔離する(モジュール状態のテスト間漏れを防ぐ——src/lib/externalIO/CLAUDE.mdの
// 「モジュール状態はテスト間で永続する」の型と同じ)。永続層はテスト側で共有の擬似ストアを
// 渡せるので、「新しいタブ」= モジュール再読み込みだけを差し替えて再現できる。
import { afterEach, describe, expect, it, vi } from "vitest";

type LaunchFn = ReturnType<typeof vi.fn>;

/** chrome.storage.localの最小スタブ。storeを渡し回すことでタブ間共有を再現する。 */
function storageStub(store: Record<string, unknown>) {
  return {
    local: {
      get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
      remove: vi.fn(async (key: string) => {
        delete store[key];
      }),
    },
  };
}

/** chromeスタブを組んでgoogleAuthを新規に読み込む(=新しいタブでの初回読み込み相当)。
 * storeを使い回せば「別タブだが同じchrome.storage.local」を再現できる。 */
async function load(launchWebAuthFlow: LaunchFn, store: Record<string, unknown> = {}) {
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
    storage: storageStub(store),
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

  it("implicitフローのURLで呼ぶ(カスタムURIスキーム回避)", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    await getAuthToken(true);
    const arg = launch.mock.calls[0][0] as { url: string; interactive: boolean };
    expect(arg.interactive).toBe(true);
    const url = new URL(arg.url);
    expect(url.searchParams.get("response_type")).toBe("token");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://ext-id.chromiumapp.org/");
    expect(url.searchParams.get("scope")).toBe("https://scope-a https://scope-b");
  });

  it("非対話時はabortOnLoadForNonInteractive:falseとタイムアウトを渡す(サイレント更新がGoogleのリダイレクト連鎖の途中で打ち切られ`User interaction required`になっていた実機不具合の回帰)", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    await getAuthToken(false);
    const arg = launch.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.abortOnLoadForNonInteractive).toBe(false);
    expect(arg.timeoutMsForNonInteractive).toBeGreaterThan(0);
  });

  it("対話時はabortOnLoadForNonInteractive等を渡さない(ユーザー操作を待つため)", async () => {
    const launch = vi.fn().mockResolvedValue(redirectWith("abc123"));
    const { getAuthToken } = await load(launch);
    await getAuthToken(true);
    const arg = launch.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.abortOnLoadForNonInteractive).toBeUndefined();
    expect(arg.timeoutMsForNonInteractive).toBeUndefined();
  });

  it("回帰: 新しいタブ(モジュール再読み込み)でも認可フローを再実行せず永続トークンを再利用する", async () => {
    // 実害の再現条件そのもの。キャッシュがモジュール変数だけだった頃は、タブを開くたびに
    // 空から始まってサイレント認可が走り、それが失敗してDrive連携が丸ごと停止していた。
    const store: Record<string, unknown> = {};
    const launch = vi.fn().mockResolvedValue(redirectWith("persisted-token", 3600));

    const firstTab = await load(launch, store);
    expect(await firstTab.getAuthToken(true)).toBe("persisted-token");
    expect(launch).toHaveBeenCalledTimes(1);

    const secondTab = await load(launch, store); // 別タブ相当(モジュール状態は空・storeは共有)
    expect(await secondTab.getAuthToken(false)).toBe("persisted-token");
    expect(launch).toHaveBeenCalledTimes(1); // 再認可は走らない
  });

  it("永続トークンが失効していれば取り直す", async () => {
    // expiresAtは固定値(1970-01-01)——現在時刻に対して確実に過去なので、テストは
    // 実行時刻に依存しない(§9.2 test-nondeterminism)。
    const store: Record<string, unknown> = {
      driveAccessToken: { token: "expired", expiresAt: 0 },
    };
    const launch = vi.fn().mockResolvedValue(redirectWith("renewed"));
    const { getAuthToken } = await load(launch, store);
    expect(await getAuthToken(false)).toBe("renewed");
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("永続層が壊れていても落ちず取り直す", async () => {
    const store: Record<string, unknown> = { driveAccessToken: { nonsense: true } };
    const launch = vi.fn().mockResolvedValue(redirectWith("recovered"));
    const { getAuthToken } = await load(launch, store);
    expect(await getAuthToken(false)).toBe("recovered");
  });

  it("同時に呼ばれても認可フローは1回だけ走る(全ペインが同時に同期を始める競合の回帰)", async () => {
    // deferredは先に作る——launch()が呼ばれてからresolverを受け取る書き方だと、
    // テスト側がresolveする時点でまだlaunch()に到達しておらず取りこぼす。
    let resolveLaunch: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      resolveLaunch = resolve;
    });
    const launch = vi.fn(() => pending);
    const { getAuthToken } = await load(launch as unknown as LaunchFn);
    const both = Promise.all([getAuthToken(false), getAuthToken(false)]);
    resolveLaunch(redirectWith("single"));
    expect(await both).toEqual(["single", "single"]);
    expect(launch).toHaveBeenCalledTimes(1);
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

describe("getOAuthClientId", () => {
  it("manifest.jsonのoauth2.client_idを返す(pickerOAuth.ts等が使い回すため)", async () => {
    const { getOAuthClientId } = await load(vi.fn());
    expect(getOAuthClientId()).toBe("test-client-id");
  });
});

describe("invalidateToken", () => {
  it("メモリと永続の両方から外し、次回はlaunchWebAuthFlowを再度呼ぶ", async () => {
    const store: Record<string, unknown> = {};
    const launch = vi
      .fn()
      .mockResolvedValueOnce(redirectWith("first"))
      .mockResolvedValueOnce(redirectWith("second"));
    const { getAuthToken, invalidateToken } = await load(launch, store);
    expect(await getAuthToken(true)).toBe("first");
    await invalidateToken("first");
    expect(store.driveAccessToken).toBeUndefined(); // 永続層からも消える
    expect(await getAuthToken(true)).toBe("second");
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("別のトークンを指定された場合は永続トークンを消さない", async () => {
    const store: Record<string, unknown> = {};
    const launch = vi.fn().mockResolvedValue(redirectWith("keep-me"));
    const { getAuthToken, invalidateToken } = await load(launch, store);
    await getAuthToken(true);
    await invalidateToken("someone-elses-token");
    expect(store.driveAccessToken).toBeDefined();
  });
});
